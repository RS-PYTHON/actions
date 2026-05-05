# actions
This repository provides reusable GitHub workflows and composite actions for all RS-PYTHON repositories.

## Reusable workflows

See: https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows

### *Check code quality*

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

## Composite actions

See: https://docs.github.com/en/actions/tutorials/create-actions/create-a-composite-action

### *Build wheel and sdist*

Path: `actions/.github/actions/build-wheel/action.yml`

Build wheel and sdist packages from a poetry project.

### *Publish Docker image*

Path: `actions/.github/actions/publish-docker/action.yml`

Build and push a Docker image, and pass Trivy on it.

### *Set environment for publishing Docker images*

Path: `actions/.github/actions/set-binary-env/action.yml`

Set variables depending on the git context: branch name, docker tags and debug mode.

### *Install Python and Poetry*

Path: `actions/.github/actions/setup-poetry/action.yml`

### *Tag and push Docker images*

Path: `actions/.github/actions/tag-push-docker/action.yml`

This is used to retag and push temporary Docker images with final tags, after the tests have passed.
