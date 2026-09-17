// Copyright 2023-2026 Airbus, CS Group
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Run javascript functions from imported module

const { default: mod } = await import('./clean-old-docker.js')

// Init octokit, see https://octokit.github.io/rest.js
import { Octokit } from "@octokit/rest"
const githubPat = process.env.GITHUB_PAT // read github private access token from the env var
const appOctokit = new Octokit({ auth: githubPat})

// Get all docker images, sorted by repository
const imagesByRepo = await mod.getImages(appOctokit)

// Dry run on one repo
const repo = "rs-dpr-service"
await mod.cleanRepo(appOctokit, repo, imagesByRepo.get(repo), true)


// TODO GÉRER CACHE https://github.com/actions/cache
// SUPPRIMER //// TEMP !!!!!!!!!!!!!!!!!!!!!
