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

Path: `.github/actions/build-wheel/action.yml`

Build wheel and sdist packages from a poetry project.

### *Cancel workflow runs*

Path: `.github/actions/cancel-workflow-runs/action.yml`

Cancel github workflow runs from any repository. Used to avoid duplicate runs on the same workflow.

### *Get repository branch*

Path: `.github/actions/get-repo-branch/action.yml`

From a git repository, return the first branch that exists from a list, e.g. 'does-not-exist,develop' will return 'develop'.

### *Publish Docker image*

Path: `.github/actions/publish-docker/action.yml`

Build and push a Docker image, and pass Trivy on it.

### *Set environment for publishing Docker images*

Path: `.github/actions/set-binary-env/action.yml`

Set variables depending on the git context: branch name, docker tags and debug mode.

### *Install Python and Poetry*

Path: `.github/actions/setup-poetry/action.yml`

### *Tag and push Docker images*

Path: `.github/actions/tag-push-docker/action.yml`

This is used to retag and push temporary Docker images with final tags, after the tests have passed.
