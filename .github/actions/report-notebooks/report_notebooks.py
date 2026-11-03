# Copyright 2023-2026 Airbus, CS Group
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
Print a Markdown report of the notebooks executed by papermill: the failed notebooks with their exact error,
and the passed notebooks.

The notebooks directory contains the output notebooks written by papermill. A notebook has failed if:
- it has a '<notebook>.error.txt' file next to it, that contains the exception raised by papermill. This is needed
  when the error is not saved in the output notebook, e.g. when the kernel died.
- or one of its cells has an error output, or is marked as failed by papermill.

The output notebooks named after their path with the '/' replaced by '__' (e.g. 'notebooks__demos__demo.ipynb')
are displayed with their original path (e.g. 'notebooks/demos/demo.ipynb').
"""

import argparse
import html
import json
import os
import re
import sys
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

ERROR_SUFFIX = ".error.txt"
PAPERMILL_ERROR_TAG = "papermill-error-cell-tag"

# GitHub refuses the comments longer than 65536 characters
MAX_REPORT_LENGTH = 60000
MAX_ERROR_LENGTH = 300  # in the table
MAX_TRACEBACK_LINES = 80  # in the details
MAX_TRACEBACK_LENGTH = 6000
MAX_OUTPUT_LINES = 30  # of the cells that failed without traceback

ANSI_ESCAPE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")


@dataclass
class NotebookResult:
    """Result of an executed notebook"""

    name: str
    error: str | None = None  # None if the notebook has passed
    cell: str = ""
    traceback: list[str] = field(default_factory=list)


def display_name(path: Path, root: Path) -> str:
    """Return the notebook name to display, from its output file path."""
    name = str(path.relative_to(root))
    if name.endswith(ERROR_SUFFIX):
        name = name.removesuffix(ERROR_SUFFIX)
    return name.replace("__", "/")


def strip_ansi(text: str) -> str:
    """Remove the ANSI escape sequences (colors) from the IPython tracebacks."""
    return ANSI_ESCAPE.sub("", text)


def code_cells(notebook: dict) -> list[tuple[str, dict]]:
    """Return the code cells of a papermill output notebook, with their name: 'In [<execution count>]' or 'cell <n>'"""
    cells = [
        cell
        for cell in notebook.get("cells", [])
        if PAPERMILL_ERROR_TAG not in cell.get("metadata", {}).get("tags", [])
    ]
    return [
        (
            f"In [{cell['execution_count']}]" if cell.get("execution_count") is not None else f"cell {index}",
            cell,
        )
        for index, cell in enumerate(cells, start=1)
        if cell.get("cell_type") == "code"
    ]


def is_sys_exit_ok(output: dict) -> bool:
    """Return True if a cell error output is a successful sys.exit(), that papermill doesn't consider as an error."""
    return output.get("ename") == "SystemExit" and output.get("evalue", "") in ("", "0")


def cell_context(cell: dict, title: str) -> list[str]:
    """Return the source and the last outputs of a cell, to understand an error without traceback."""
    source = cell.get("source", "")
    lines = [f"# {title}:", *("".join(source) if isinstance(source, list) else source).splitlines()]
    outputs = "".join(
        "".join(text) if isinstance(text := output.get("text", ""), list) else text
        for output in cell.get("outputs", [])
        if output.get("output_type") == "stream"
    ).splitlines()
    if outputs:
        lines += ["", "# Last outputs of the cell:", *outputs[-MAX_OUTPUT_LINES:]]
    return lines


def cell_error(cell: dict, cell_name: str) -> tuple[str, list[str]] | None:
    """Return the error of a cell as (error message, traceback), or None if the cell has no error."""
    errors = [output for output in cell.get("outputs", []) if output.get("output_type") == "error"]
    for output in errors:
        if not is_sys_exit_ok(output):
            ename, evalue = output.get("ename", ""), output.get("evalue", "")
            message = f"{ename}: {evalue}" if evalue else ename
            return message, strip_ansi("\n".join(output.get("traceback", []))).splitlines()

    # Error raised without an error output
    if not errors and cell.get("metadata", {}).get("papermill", {}).get("exception") is True:
        return "The cell failed without an error output, see its details", cell_context(cell, f"Source of {cell_name}")
    return None


def read_cell_error(notebook: dict) -> tuple[str, str, list[str]] | None:
    """
    Return the first error of a papermill output notebook as (error message, cell name, traceback),
    or None if the notebook has no error. Same logic as papermill.execute.raise_for_execution_errors.
    """
    for cell_name, cell in code_cells(notebook):
        if error := cell_error(cell, cell_name):
            return error[0], cell_name, error[1]

    # Note: papermill also sets the notebook 'exception' metadata when a cell calls sys.exit(0), e.g. to skip the end of
    # the notebook, but it is not an error.
    return None


def last_started_cell(notebook: dict) -> tuple[str, list[str]]:
    """
    Return the name and source of the last cell started by papermill, i.e. the cell that was running when an error
    occurred outside of the cells, e.g. when the kernel died.
    """
    started = [
        (cell_name, cell)
        for cell_name, cell in code_cells(notebook)
        if cell.get("metadata", {}).get("papermill", {}).get("start_time")
    ]
    if not started:
        return "", []
    cell_name, cell = started[-1]
    return cell_name, cell_context(cell, f"Source of the cell that was running ({cell_name})")


def read_notebook(path: Path) -> dict:
    """Read a notebook file"""
    return json.loads(path.read_text(encoding="utf-8"))


def read_results(notebooks_dir: Path) -> list[NotebookResult]:
    """Read the results of all the output notebooks of a directory."""
    results: dict[str, NotebookResult] = {}
    if not notebooks_dir.is_dir():
        return []

    for path in sorted(notebooks_dir.rglob("*.ipynb")):
        if ".ipynb_checkpoints" in path.parts:
            continue
        result = NotebookResult(display_name(path, notebooks_dir))
        try:
            error = read_cell_error(read_notebook(path))
        except (OSError, ValueError) as exception:
            error = (f"Cannot read the output notebook: {exception}", "", [])
        if error:
            result.error, result.cell, result.traceback = error
        results[result.name] = result

    # Errors that are not saved in the output notebooks, e.g. when the kernel died.
    # The output notebook may not exist if papermill failed before writing it.
    for path in sorted(notebooks_dir.rglob(f"*.ipynb{ERROR_SUFFIX}")):
        name = display_name(path, notebooks_dir)
        result = results.setdefault(name, NotebookResult(name))
        result.error = path.read_text(encoding="utf-8", errors="replace").strip() or "Unknown error"
        try:
            result.cell, result.traceback = last_started_cell(
                read_notebook(path.with_name(path.name.removesuffix(ERROR_SUFFIX))),
            )
        except (OSError, ValueError):
            result.cell, result.traceback = "", []

    return sorted(results.values(), key=lambda result: result.name)


def truncate(text: str, length: int) -> str:
    """Truncate a text to a max length."""
    return text if len(text) <= length else text[: length - 1] + "…"


def table_cell(text: str) -> str:
    """Format a text to be displayed as code in a Markdown table cell."""
    text = html.escape(truncate(text.strip(), MAX_ERROR_LENGTH)).replace("|", "&#124;")
    return f"<code>{'<br>'.join(text.splitlines())}</code>"


def code_block(lines: list[str]) -> str:
    """Format the last lines of a traceback as a Markdown code block."""
    if len(lines) > MAX_TRACEBACK_LINES:
        lines = ["[...]"] + lines[-MAX_TRACEBACK_LINES:]
    text = "\n".join(lines)
    if len(text) > MAX_TRACEBACK_LENGTH:
        text = "[...]" + text[-MAX_TRACEBACK_LENGTH:]
    # The fence must be longer than any backtick sequence in the code
    fence = "`" * max(3, max((len(match) for match in re.findall("`+", text)), default=0) + 1)
    return f"{fence}text\n{text}\n{fence}"


def report_status(results: list[NotebookResult], outcome: str) -> str:
    """Return the global status of the report."""
    failed = sum(result.error is not None for result in results)
    passed = len(results) - failed
    if failed:
        return f":x: {failed} failed, {passed} passed"
    if outcome == "failure":
        passed_text = f" ({passed} notebooks passed)" if passed else ""
        return f":x: Failed outside of the notebooks execution{passed_text}, see the job logs"
    if outcome in ("skipped", "cancelled"):
        return f":warning: Not run ({outcome})"
    if not results:
        return ":warning: No executed notebook found"
    return f":white_check_mark: All the {passed} notebooks passed"


def details_block(summary: str, content: list[str]) -> list[str]:
    """Return a collapsed Markdown section."""
    return [f"<details><summary>{summary}</summary>", "", *content, "", "</details>", ""]


def write_report(results: list[NotebookResult], header: list[str]) -> str:
    """Return the Markdown report, from the results and the header lines."""
    failed = [result for result in results if result.error is not None]
    passed = [result for result in results if result.error is None]
    footer = [f"###### _updated: {datetime.now(UTC):%Y-%m-%d %H:%M:%S} (UTC)_"]

    def fits(new_lines: list[str]) -> bool:
        return len("\n".join(lines + new_lines + footer)) <= MAX_REPORT_LENGTH

    lines = [*header, ""]
    if failed:
        lines += ["| Notebook | Cell | Error |", "|:---|:---:|:---|"]
        lines += [f"| `{result.name}` | {result.cell} | {table_cell(result.error or '')} |" for result in failed]
        lines.append("")

        # Add the tracebacks while the report is not too long
        with_traceback = [result for result in failed if result.traceback]
        for index, result in enumerate(with_traceback):
            details = details_block(f"<code>{html.escape(result.name)}</code> details", [code_block(result.traceback)])
            if not fits(details):
                lines += [
                    f"_{len(with_traceback) - index} more details not displayed: see the executed notebooks._",
                    "",
                ]
                break
            lines += details

    if passed:
        details = details_block(f"{len(passed)} passed notebooks", [f"- `{result.name}`" for result in passed])
        if fits(details):
            lines += details

    return "\n".join(lines + footer) + "\n"


def main():
    """Main function"""
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("notebooks_dir", type=Path, help="Directory of the papermill output notebooks")
    parser.add_argument("--title", default="Notebooks")
    parser.add_argument(
        "--outcome",
        default="",
        help="Outcome of the step that ran the notebooks: success, failure, cancelled or skipped",
    )
    parser.add_argument("--marker", default="", help="Hidden HTML comment to find the report in the PR comments")
    parser.add_argument("--commit", default="")
    parser.add_argument("--run-url", default="")
    parser.add_argument("--run-name", default="")
    parser.add_argument("--artifact-url", default="")
    args = parser.parse_args()

    results = read_results(args.notebooks_dir)

    header = [args.marker, f"### {args.title}", f"- **Result**: {report_status(results, args.outcome)}"]
    if args.commit:
        header.append(f"- **Commit**: {args.commit}")
    links = []
    if args.run_url:
        links.append(f"[{args.run_name or 'Workflow run'}]({args.run_url})")
    if args.artifact_url:
        links.append(f"[Executed notebooks]({args.artifact_url})")
    if links:
        header.append(f"- **Details**: {' · '.join(links)}")

    print(write_report(results, header), end="")

    failed = sum(result.error is not None for result in results)
    print(f"{failed} failed notebooks, {len(results) - failed} passed notebooks", file=sys.stderr)
    if github_output := os.getenv("GITHUB_OUTPUT"):
        with open(github_output, "a", encoding="utf-8") as file:
            file.write(f"failed={failed}\n")


if __name__ == "__main__":
    main()
