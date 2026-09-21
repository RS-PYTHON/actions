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

// Clean old Docker image versions from the GitHub container registry (GHCR)

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { format } from 'util'

const org = "RS-PYTHON"
const package_type = "container"

const cacheLastRun = "cache_last_run"
const cacheManifestTemplate = "cache_manifest_%s"

// 1 week ago
const lastWeek = new Date()
lastWeek.setDate(lastWeek.getDate() - 7)

// Remove docker image versions with old git tags, only for these images
const removeOldTagsFor = await getRemoveOldTagsFor()

///////////////////////
// Utility functions //
///////////////////////

// JSON.stringify on a Map
function jsonStringifyMap(map) {
    return JSON.stringify(map, (key, value) => {
        if (value instanceof Map) {
            return Object.fromEntries(value);
        }
        return value;
    }, 2);
}

// Add key/value to a map of arrays
function pushToMapArray(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

// Only alphanumeric characters, . - and _ are allowed in docker image tags.
// Replace other characters by -
// NOTE: copy/pasted from actions/.github/actions/set-binary-env/action.yml
function removeSpecial(str) {
    return str.replace(/[^a-zA-Z0-9\.\-\_]/g, "-")
}

// Remove docker image versions with old git tags, only for these images
async function getRemoveOldTagsFor()
{
    const images = []

    // Read text file from the same directory as current module
    const __dirname = dirname(fileURLToPath(import.meta.url))
    const filePath = join(__dirname, "remove-old-tags.txt")
    const contents = readFileSync(filePath, "utf8")
    contents.split("\n").forEach(line => {
        images.push(line.trim())
    })
    return images
}

// Read cache of manifest lists for a list of docker images
function readCacheManifests(images, cacheAllManifests, cacheDir)
{
    images.forEach(image => {
        try {
            const cacheFile = join(cacheDir, format(cacheManifestTemplate, removeSpecial(image)))
            const str = readFileSync(cacheFile, "utf8")
            cacheAllManifests.set(image, new Map(Object.entries(JSON.parse(str))))
        }
        catch {}
    })

    if (["1", "true"].includes(process.env.PRINT_CACHE)) {
        console.log(`\nRead cached manifests:\n${jsonStringifyMap(cacheAllManifests)}\n`)
    }
}

// Write cache of manifest lists
function writeCacheManifests(cacheAllManifests, cacheDir)
{
    if (["1", "true"].includes(process.env.PRINT_CACHE)) {
        console.log(`\nWrite cached manifests:\n${jsonStringifyMap(cacheAllManifests)}\n`)
    }

    if (!existsSync(cacheDir)) {
        mkdirSync(cacheDir)
    }
    cacheAllManifests.forEach((cached, image) => {
        const cacheFile = join(cacheDir, format(cacheManifestTemplate, removeSpecial(image)))
        const str = jsonStringifyMap(cached)
        writeFileSync(cacheFile, str, "utf8")
    })
}

// Return a token used for https://ghcr.io/v2/${org}/${image}/manifests/${sha256}
async function getRegistryToken(image)
{
    // From the env var, read the github private access token (pat) with read:packages
    const basic = Buffer.from(`token:${process.env.GITHUB_PAT}`).toString("base64")
    const url = `https://ghcr.io/token?scope=repository:${org}/${image}:pull`
    const res = await fetch(url, {headers: {
            Authorization: `Basic ${basic}`
        }})
    const content = await res.json()
    if (!res.ok) {
        throw new Error(`Error '${res.status}' calling ${url}: ${JSON.stringify(content)}`)
    }
    return content.token;
}

// Return more manifest info and notably the list of children manifests, if any.
// This seems to do about the same thing than the "docker manifest inspect" command line.
async function inspectManifest(token, image, sha256)
{
    const url = `https://ghcr.io/v2/${org}/${image}/manifests/${sha256}`
    const res = await fetch(url, {headers: {
            Authorization: `Bearer ${token}`,
            Accept: [
                "application/vnd.oci.image.index.v1+json",
                "application/vnd.docker.distribution.manifest.list.v2+json",
                "application/vnd.oci.image.manifest.v1+json",
                "application/vnd.docker.distribution.manifest.v2+json",
                ].join(",")
        }})
    const content = await res.json()
    if (!res.ok) {
        throw new Error(`Error '${res.status}' calling ${url}: ${JSON.stringify(content)}`)
    }
    return content
}

////////////////////
// Main functions //
////////////////////

// Return all docker images, sorted by repository
async function getImages(
    appOctokit // octokit client
) {
    // Get all container packages = docker images
    const allRepoImages = await appOctokit.paginate(appOctokit.rest.packages.listPackagesForOrganization, {
        package_type,
        org,
    })

    // Sort them by git repository and last update
    let imagesByRepo = new Map() // {repo: [image]}
    let imagesByDate = new Map()
    await allRepoImages.forEach(p => {
        pushToMapArray(imagesByRepo, p.repository.name, p.name)
        imagesByDate.set(p.name, new Date(p.updated_at))
    })

    // Sort maps
    imagesByRepo = new Map([...imagesByRepo.entries()].sort()) // sort by keys
    imagesByRepo.forEach((value, key) => { // sort values, which are arrays
        imagesByRepo.set(key, value.toSorted())
    })
    imagesByDate = new Map([...imagesByDate.entries()].sort((a, b) => b[1] - a[1])); // sort by values
    imagesByDate.forEach((value, key) => { // format values, which are dates
        imagesByDate.set(key, value.toISOString().split("T")[0])
    })

    // Hard test a single repo
    // imagesByRepo = new Map([["rs-testmeans", ["rs-testmeans_adgs-station-mock"]]])

    console.log(
        "\n" +
        "Docker images by repository\n" +
        "###########################\n" +
        jsonStringifyMap(imagesByRepo)
    )
    console.log(
        "\n" +
        "Docker images by update date\n" +
        "############################\n" +
        jsonStringifyMap(imagesByDate)
    )
    return imagesByRepo
}

// Clean old Docker image versions for a given git repository
async function cleanRepo(
    appOctokit, // octokit client
    cacheAllManifests, // Map as {image: {parentSha: [childSha]}}
    repo, // git repository (str)
    images, // docker images [str]
    dryRun=false // if true, only print logs, don't delete anything
) {
    // Get all branches and tags of the git repository.
    // The Docker image version tags that don't match this list should be deleted.
    const repoBranchesAndTags = [
        // Keep these Docker image versions
        "latest", "latest-cache", "latest-temp-cicd", "latest-temp-cicd-cache"
    ]
    await appOctokit.paginate(appOctokit.rest.repos.listBranches, {owner: org, repo}).then(branches => {
        branches.forEach(branch => {
            const branchName = removeSpecial(branch.name)
            repoBranchesAndTags.push(branchName)
            repoBranchesAndTags.push(branchName + "-cache")
    })})
    await appOctokit.paginate(appOctokit.rest.repos.listTags, {owner: org, repo}).then(tags => {
        tags.forEach(tag => {
            const tagName = removeSpecial(tag.name)
            repoBranchesAndTags.push(tagName)
            // Test with and without the leading 'v'
            if (tagName.startsWith("v")) {
                repoBranchesAndTags.push(tagName.substring(1))
            } else {
                repoBranchesAndTags.push("v" + tagName)
            }
    })})

    // Docker image versions that have a tag from an existing or old branch

    const existingTags = new Map() // {image: [manifest]}
    const oldTags = new Map() // {image: [manifest]}
    const recentUntagged = new Map() // {image: [manifest]}

    const logExistingTags = new Map() // {image: ["tags (sha256)"]}
    const logOldTags = new Map() // {image: ["tags (sha256)"]}
    const logRecentUntagged = new Map() // {image: [sha256]}
    const logChildManifest = new Map() // {image: [sha256]}

    await images.forEach(image => {
        existingTags.set(image, [])
        oldTags.set(image, [])
        recentUntagged.set(image, [])
        logExistingTags.set(image, [])
        logOldTags.set(image, [])
        logRecentUntagged.set(image, [])
        logChildManifest.set(image, [])
    })

    // Clean old docker image versions
    async function _cleanImageVersions(image)
    {
        // Each docker image version is actually called a "manifest".
        // Each manifest can have chil manifests (in case of multi-arch build).
        // These child manifests have no tagged, but they must not be deleted !
        // For every existing manifest, we save the list of its child manifests.
        const allManifests = new Map() // sha256 => {"id": package_version_id, "children": [sha256]}
        const token = await getRegistryToken(image) // token to request the child manifests

        // Init the cache
        if (!cacheAllManifests.has(image)) {
            cacheAllManifests.set(image, new Map())
        }

        // Paginate all versions
        const versionPages = appOctokit.paginate.iterator(
            appOctokit.rest.packages.getAllPackageVersionsForPackageOwnedByOrg, {
                package_type,
                package_name: image,
                org
            })
        for await (const {data: versions} of versionPages)
        {
            // For each docker image version (=manifest)
            await Promise.all(versions.map(async (manifest) =>
            {
                const manifestSha = manifest.name // sha256
                const manifestId = manifest.id // package version id
                const manifestTags = manifest.metadata.container.tags // docker image tags

                // Try to get the child manifests from the cache
                const cached = cacheAllManifests.get(image).get(manifestSha)
                if (cached != undefined) {
                    allManifests.set(manifestSha, structuredClone(cached))
                }

                // Else retrieve them from remote
                else
                {
                    const ref = (manifestTags.length == 0) ? `@${manifestSha}` : `:${manifestTags[0]}`
                    console.log(`Read child manifests for ${image}${ref}`)

                    allManifests.set(manifestSha, {"id": manifestId, "childrenSha": []})
                    const inspect = await inspectManifest(token, image, manifestSha)
                    if ("manifests" in inspect) {
                        for (const child of inspect.manifests) {
                            allManifests.get(manifestSha).childrenSha.push(child.digest)
                        }
                    }

                    // Update the cache for the current manifest
                    cacheAllManifests.get(image).set(manifestSha, allManifests.get(manifestSha))
                }

                // If no tags...
                if (manifestTags.length == 0) {
                    // But too recent to be deleted
                    if (new Date(manifest.updated_at) > lastWeek) {
                        recentUntagged.get(image).push(manifest)
                        logRecentUntagged.get(image).push(manifestSha)
                    }
                // Else check if the tag corresponds to a git tag or branch
                } else {
                    const logId = `${manifestTags.join(",")} (${manifestSha})`
                    if (
                        (removeOldTagsFor.includes(image)) &&
                        (manifestTags.filter(value => repoBranchesAndTags.includes(value)).length == 0)
                    ) {
                        oldTags.get(image).push(manifest)
                        logOldTags.get(image).push(logId)
                    } else {
                        existingTags.get(image).push(manifest)
                        logExistingTags.get(image).push(logId)
                    }
                } // we have tags
            })) // for each version (=manifest)
        } // for each versionPages

        // Update the cache for all manifests (so we remove old/deleted manifests from the cache)
        cacheAllManifests.set(image, new Map(allManifests))

        // Recursively walk all the manifests. Remove those we want to keep.
        function cleanManifests(parentSha, firstLevel=true)
        {
            // Current sha has already been cleaned
            if (!allManifests.get(parentSha)) {
                return
            }

            // Save sha for logging
            if (!firstLevel) {
                logChildManifest.get(image).push(parentSha)
            }

            // Recursive calls
            for (const childSha of allManifests.get(parentSha).childrenSha) {
                cleanManifests(childSha, false)
            }

            // Remove manifest from map
            allManifests.delete(parentSha)
        }

        // Call the recursive function for all first level manifests we keep
        for (const keepManifests of [existingTags, recentUntagged]) { // NOTE: don't keep oldTags
            for (const manifest of keepManifests.get(image)) {
                cleanManifests(manifest.name)
            }
        }

        // Remove duplicate shas from logs
        logRecentUntagged.set(
            image,
            logRecentUntagged.get(image).filter(sha => !logChildManifest.get(image).includes(sha))
        )

        if (allManifests.size == 0) {
            console.log(`Nothing to delete for ${image}`)
        }
        // Delete remaining manifests. Iterate over (first level sha / package version id)
        else {
            await Promise.all([...allManifests].flatMap(async ([manifestSha, {id: manifestId}]) => {
                console.log(`Delete ${image}@${manifestSha} (${manifestId})`)
                if (!dryRun) {
                    await appOctokit.rest.packages.deletePackageVersionForOrg({
                        package_type,
                        package_name: image,
                        org,
                        package_version_id: manifestId
                    })
                }
            }))
        }
    } // function _cleanImageVersions

    // Clean all images
    await Promise.all(images.map(async (image) => _cleanImageVersions(image)))

    console.log(
        "\n" +
        "These old tags were deleted\n" +
        "###########################\n" +
        jsonStringifyMap(logOldTags)
    )
    console.log(
        "\n" +
        "These are child manifests of versions we keep (don't delete them !)\n" +
        "###################################################################\n" +
        jsonStringifyMap(logChildManifest)
    )
    console.log(
        "\n" +
        "These have no tags but are too recent to be deleted\n" +
        "###################################################\n" +
        jsonStringifyMap(logRecentUntagged)
    )
    console.log(
        "\n" +
        "We keep these recent tags\n" +
        "#########################\n" +
        jsonStringifyMap(logExistingTags)
    )
} // function cleanRepo

/////////////
// Exports //
/////////////

export default {cacheLastRun, cleanRepo, getImages, readCacheManifests, writeCacheManifests}
