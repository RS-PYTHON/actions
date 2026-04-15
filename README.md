# actions
This repository provides reusable GitHub workflows and composite actions for all RS-PYTHON repositories.

## `Check code quality` workflow

Path: `.github/workflows/reusable-check-quality.yml`

This workflow runs the following on the calling GitHub repository:

  * Check pre-commit
  * Check license headers
  * Trivy
  * Bandit
  * Flake8
  * Mypy
  * Pylint
  * Safety
  * Pytest
  * SonarQube
