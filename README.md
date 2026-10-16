# actions

Reusable [GitHub Actions](https://docs.github.com/en/actions) workflows and composite actions shared by all the
repositories of [RS-Python](https://github.com/RS-PYTHON/rs-documentation).

## Overview

The CI/CD of the RS-Python repositories, and the dependencies between them, are described in
[Repositories and CI/CD](https://github.com/RS-PYTHON/rs-documentation/blob/develop/docs/developers/ci-cd.md). This
repository factorises its common parts:

- a [reusable workflow](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows) that checks
  the code quality of a repository,
- [composite actions](https://docs.github.com/en/actions/tutorials/create-actions/create-a-composite-action) used by
  the build and publication workflows,
- maintenance workflows of the GitHub organisation.

### Reusable workflow

| Workflow | Description |
|---|---|
| [reusable-check-quality.yml](.github/workflows/reusable-check-quality.yml) | Check the code quality of the calling repository: [pre-commit](https://pre-commit.com/), license headers ([SkyWalking Eyes](https://github.com/apache/skywalking-eyes)), [Trivy](https://trivy.dev/) (vulnerabilities and misconfigurations), [Bandit](https://bandit.readthedocs.io/), [Flake8](https://flake8.pycqa.org/), [Mypy](https://mypy-lang.org/), [Pylint](https://pylint.readthedocs.io/), [Safety](https://safetycli.com/), [Pytest](https://docs.pytest.org/) with coverage, and [SonarQube Cloud](https://sonarcloud.io/) with its quality gate. |

Usage, from the `.github/workflows/check-code-quality.yml` file of a repository:

```yaml
jobs:
  check-code-quality:
    uses: RS-PYTHON/actions/.github/workflows/reusable-check-quality.yml@develop
    with:
      caller-repository: ${{ github.repository }}
      caller-ref: ${{ github.ref }}
      caller-ref_name: ${{ github.ref_name }}
    secrets:
      SAFETY_API_KEY: ${{ secrets.SAFETY_API_KEY }}
      SONAR_TOKEN: ${{ secrets.SONAR_TOKEN }}
```

The other inputs (Python and Poetry versions, directories covered by the tests, Sonar exclusions, tools whose errors
are ignored...) are described in the workflow file.

### Composite actions

| Action | Description |
|---|---|
| [build-wheel](.github/actions/build-wheel/action.yml) | Build the wheel and sdist packages of a [Poetry](https://python-poetry.org/) project. |
| [cancel-workflow-runs](.github/actions/cancel-workflow-runs/action.yml) | Cancel the workflow runs of any repository, to avoid duplicate runs of the same workflow. |
| [get-image-tag](.github/actions/get-image-tag/action.yml) | Return the first Docker image tag that exists in a list, e.g. `does-not-exist,latest` returns `latest`. |
| [get-repo-branch](.github/actions/get-repo-branch/action.yml) | Return the first branch of a git repository that exists in a list, e.g. `does-not-exist,develop` returns `develop`. |
| [publish-docker](.github/actions/publish-docker/action.yml) | Build and push a Docker image, and scan it with Trivy. |
| [set-binary-env](.github/actions/set-binary-env/action.yml) | Set the variables of the publication of the Docker images from the git context: branch name, Docker tags, debug mode. |
| [setup-poetry](.github/actions/setup-poetry/action.yml) | Install Python and Poetry. |
| [tag-push-docker](.github/actions/tag-push-docker/action.yml) | Tag and push the temporary Docker images with their final tags, after the tests have passed. |

Usage: `uses: RS-PYTHON/actions/.github/actions/<action>@develop`.

### Maintenance workflows

| Workflow | Description |
|---|---|
| [all-repos-check-quality.yml](.github/workflows/all-repos-check-quality.yml) | Run the code quality check on all the repositories of the organisation (manual trigger). |
| [clean-old-docker.yml](.github/workflows/clean-old-docker.yml) | Delete the old Docker images of the GitHub Container Registry of the organisation (every day), with the scripts of the [js](js) folder. |
| [check-code-quality.yml](.github/workflows/check-code-quality.yml) | Check the code quality of this repository. |

## Documentation

- [Repositories and CI/CD](https://github.com/RS-PYTHON/rs-documentation/blob/develop/docs/developers/ci-cd.md)
- [Contributing](https://github.com/RS-PYTHON/rs-documentation/blob/develop/docs/developers/contributing.md)

## Related repositories

All the RS-Python repositories use these workflows and actions, e.g. [rs-server](https://github.com/RS-PYTHON/rs-server),
[rs-client-libraries](https://github.com/RS-PYTHON/rs-client-libraries) and
[rs-dpr-service](https://github.com/RS-PYTHON/rs-dpr-service).

## Contributing

See the [contribution guidelines](https://github.com/RS-PYTHON/rs-documentation/blob/develop/docs/developers/contributing.md).
Report bugs in the [issue tracker](https://github.com/RS-PYTHON/actions/issues). In case of sensitive bugs like
security vulnerabilities, please contact <ops_coprs@airbus.com> directly instead of using the issue tracker.

## Licensing

The code in this project is licensed under the [Apache License, Version 2.0](https://www.apache.org/licenses/LICENSE-2.0).

---

![](https://raw.githubusercontent.com/RS-PYTHON/.github/refs/heads/main/profile/banner_logo.jpg)

This project is funded by the EU and ESA.
