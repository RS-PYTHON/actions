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

const org = "RS-PYTHON"
const package_type = "container"

// 1 week ago
const lastWeek = new Date()
lastWeek.setDate(lastWeek.getDate() - 7)

// For these docker images, always keep old docker tagged versions
const keepOldTagsFor = [
    "dask/dask-gateway",
    "prefecthq/prefect",
    "python",
    "stac-browser"
]

///////////////////////
// Utility functions //
///////////////////////

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
async function getImages(appOctokit)
{
    // Get all container packages = docker images
    const allRepoImages = await appOctokit.paginate(appOctokit.rest.packages.listPackagesForOrganization, {
        package_type,
        org,
    })

    // Sort them by git repository and last update
    let imagesByRepo = new Map()
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

    console.log(
        "\n" +
        "Docker images by repository\n" +
        "###########################\n" +
        JSON.stringify(Object.fromEntries(imagesByRepo), null, 2)
    )
    console.log(
        "\n" +
        "Docker images by update date\n" +
        "############################\n" +
        JSON.stringify(Object.fromEntries(imagesByDate), null, 2)
    )
    return imagesByRepo
}

// Clean old Docker image versions for a given git repository
async function cleanRepo(appOctokit, repo, images, dryRun=false)
{
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

    const existingTags = new Map() // image => [manifest]
    const oldTags = new Map() // image => [manifest]
    const recentUntagged = new Map() // image => [manifest]

    const logExistingTags = new Map() // image => [tags / sha256]
    const logOldTags = new Map() // image => [tags / sha256]
    const logRecentUntagged = new Map() // image => [sha256]
    const logChildManifest = new Map() // image => [sha256]

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
        // Each manifest can have children manifests (in case of multi-arch build).
        // These children manifests have no tagged, but they must not be deleted !
        // For every existing manifest, we save the list of its children manifests.
        const allManifests = new Map() // sha256 => {"id": package_version_id, "children": [sha256]}
        const token = await getRegistryToken(image)

        // Paginate all versions
        const versionPages = appOctokit.paginate.iterator(
            appOctokit.rest.packages.getAllPackageVersionsForPackageOwnedByOrg, {
                package_type,
                package_name: image,
                org
            })
        for await (const {data: versions} of versionPages) {

            //// TEMP !!!!!!!!!!!!!!!!!!!!!
            if (allManifests.size > 20) break

            // For each docker image version (=manifest)
            await Promise.all(versions.map(async (manifest) =>
            {
                const manifestSha = manifest.name // sha256
                const manifestId = manifest.id // package version id
                const manifestTags = manifest.metadata.container.tags // docker image tags


                //// TEMP !!!!!!!!!!!!!!!!!!!!!
                if (allManifests.size > 20) return



                // Get the child manifest shas, if any
                allManifests.set(manifestSha, {"id": manifestId, "childrenSha": []})
                const inspect = await inspectManifest(token, image, manifestSha)
                if ("manifests" in inspect)
                {
                    const ref = (manifestTags.length == 0) ? `@${manifestSha}` : `:${manifestTags[0]}`
                    console.log(`Save child manifests for ${image}${ref}`)
                    for (const child of inspect.manifests) {
                        allManifests.get(manifestSha).childrenSha.push(child.digest)
                    }
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
                        (!keepOldTagsFor.includes(image)) &&
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
        for (const keepManifests of [existingTags, oldTags, recentUntagged]) {
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
            console.log(`Nothing to remove for ${image}`)
        }
        // Delete remaining manifests. Iterate over (first level sha / package version id)
        else {
            await Promise.all([...allManifests].flatMap(async ([manifestSha, {id: manifestId}]) => {
                console.log(`Remove ${image}@${manifestSha} (${manifestId})`)
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
    }

    // Clean all images
    await Promise.all(images.map(async (image) => _cleanImageVersions(image)))

    console.log(
        "\n" +
        "These are child manifests of versions we keep (don't delete them !)\n" +
        "###################################################################\n" +
        JSON.stringify(Object.fromEntries(logChildManifest), null, 2)
    )
    console.log(
        "\n" +
        "These have no tags but are too recent to be deleted\n" +
        "###################################################\n" +
        JSON.stringify(Object.fromEntries(logRecentUntagged), null, 2)
    )
    console.log(
        "\n" +
        "We keep these old tags but we could delete them\n" +
        "###############################################\n" +
        JSON.stringify(Object.fromEntries(logOldTags), null, 2)
    )
    console.log(
        "\n" +
        "We keep these recent tags\n" +
        "#########################\n" +
        JSON.stringify(Object.fromEntries(logExistingTags), null, 2)
    )
}

/////////////
// Exports //
/////////////

export default {getImages, cleanRepo}
