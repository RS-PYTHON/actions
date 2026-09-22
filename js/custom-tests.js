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

// Test javascript functions from imported module

////////////
// Import //
////////////

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { format } from 'util'

const { default: mod } = await import('./clean-old-docker.js')

///////////////
// Constants //
///////////////

const runParallel = true

//////////
// Main //
//////////

// Init octokit, see https://octokit.github.io/rest.js
import { Octokit } from "@octokit/rest"
const githubPat = process.env.GITHUB_PAT // read github private access token from the env var
const appOctokit = new Octokit({ auth: githubPat})

// Get all docker images, sorted by repository
const imagesByRepo = await mod.getImages(appOctokit)

// Init local cache directory
const __dirname = dirname(fileURLToPath(import.meta.url))
const cacheDir = join(__dirname, "cache")

// Read cache of manifest lists
const cacheAllManifests = new Map()
imagesByRepo.forEach((images, repo) => mod.readCacheManifests(images, cacheAllManifests, cacheDir))

// Run in parallel on all images of one git repo
if (runParallel)
{
    // Test values
    const repo = "rs-testmeans"
    let images = imagesByRepo.get(repo)
    images = [images[0]]
    // images = [images[0], images[1]]
    // images = ["rs-dpr-service_py3.11.7-2024.5.2"]

    // Run cleaning
    try {
        console.log(`\n## Clean ${repo} images: ${images} ##\n`)
        await mod.cleanRepo(appOctokit, cacheAllManifests, repo, images, true)
    }
    // Save the cache, even in case of error
    finally {
        mod.writeCacheManifests(cacheAllManifests, cacheDir)
    }
} // run parallel

// Run sequentially on each repo/image
else
{
    // Read from cache the last repo/image that was run and failed on a previous attempt
    var lastRepoRun = ""
    var lastImageRun = ""
    try {
        const cacheFile = join(cacheDir, mod.cacheLastRun)
        const str = readFileSync(cacheFile, "utf8")
        const cached = JSON.parse(str)
        lastRepoRun = cached[0]
        lastImageRun = cached[1]
    }
    catch {}

    // The first repo/image to process is the last that failed
    var firstRepoImage = 0

    // Convert map {repo: [image]} to array [[repo, image]]
    var i = 0
    const repoAndImages = []
    imagesByRepo.forEach((images, repo) => {
        images.forEach(image => {
            repoAndImages.push([repo, image])

            // Check if this is the last that failed
            if ((repo == lastRepoRun) && (image == lastImageRun)) {
                firstRepoImage = i
            }
            ++i
        })
    })

    // Run cleaning on each repo/image
    try {
        for (i = 0; i < repoAndImages.length; ++i)
        {
            const value = repoAndImages[(i + firstRepoImage) % repoAndImages.length]
            lastRepoRun = value[0]
            lastImageRun = value[1]
            const repo = lastRepoRun
            const images = [lastImageRun]
            console.log(`\n## Clean ${repo} images: ${images} ##\n`)
            await mod.cleanRepo(appOctokit, cacheAllManifests, repo, images, true)
        }

        // If no repo failed, reset these variables
        lastRepoRun = ""
        lastImageRun = ""
    }

    // Save the cache, even in case of error
    finally
    {
        // Write cache of manifest lists
        mod.writeCacheManifests(cacheAllManifests, cacheDir)

        // Write cache of the last repo/image that was run and failed
        const cacheFile = join(cacheDir, mod.cacheLastRun)
        const str = JSON.stringify([lastRepoRun, lastImageRun])
        writeFileSync(cacheFile, str, "utf8")
    }
}
