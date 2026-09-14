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

// 24h ago
const yesterday = new Date()
yesterday.setDate(yesterday.getDate() - 1)

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

////////////////////
// Main functions //
////////////////////

// Return all docker images, sorted by repository
async function getImages(octokit)
{
    // Get all container packages = docker images
    var allRepoImages = await octokit.paginate(octokit.rest.packages.listPackagesForOrganization, {
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
async function cleanRepo(octokit, repo, imagesByRepo)
{
    var images = imagesByRepo.get(repo)

    // Get all branches and tags of the git repository.
    // The Docker image version tags that don't match this list should be deleted.
    const repoBranchesAndTags = [
        // Keep these Docker image versions
        "latest", "latest-cache", "latest-temp-cicd", "latest-temp-cicd-cache"
    ]
    await octokit.paginate(octokit.rest.repos.listBranches, {owner: org, repo}).then(branches => {
        branches.forEach(branch => {
            const branchName = removeSpecial(branch.name)
            repoBranchesAndTags.push(branchName)
            repoBranchesAndTags.push(branchName + "-cache")
    })})
    await octokit.paginate(octokit.rest.repos.listTags, {owner: org, repo}).then(tags => {
        tags.forEach(tag => repoBranchesAndTags.push(removeSpecial(tag.name)))
    })

    // Docker image versions that have a tag from an existing or old branch
    const versionExistingTags = new Map()
    const versionOldTags = new Map()
    await images.forEach(image => {
        versionExistingTags.set(image, [])
        versionOldTags.set(image, [])
    })

    // Clean old docker image versions
    async function _cleanImageVersions(image)
    {
        // While we paginate all the image versions, we'll remove some of these versions.
        // I'm not sure how the pagination works in this case, so if some images were
        // removed, we'll run this function again to be sure to remove everything.
        while(true)
        {
            let cleaned = false

            // Paginate all versions
            const versionPages = octokit.paginate.iterator(
                octokit.rest.packages.getAllPackageVersionsForPackageOwnedByOrg, {
                    package_type,
                    package_name: image,
                    org
                })
            for await (const {data: versions} of versionPages) {
                // For each docker image version
                await Promise.all(versions.map(async (version) =>
                {
                    // Image version tags
                    const currentVersionTags = version.metadata.container.tags

                    // If no tags, and if older than 24h, remove this version
                    if (currentVersionTags.length == 0) {
                        if (new Date(version.updated_at) < yesterday)
                        {
                            console.log(`Remove ${image}@${version.name}`)
                            // await octokit.rest.packages.deletePackageVersionForOrg({ // TEST, TO BE REMOVED !
                            //     package_type,
                            //     package_name: image,
                            //     org,
                            //     package_version_id: version.id
                            // })
                            // cleaned = true // redo the pagination/delete on next loop
                        }
                        else {
                            versionExistingTags.get(image).push(version.name)
                        }
                    }

                    // Else check if the tag corresponds to a git tag or branch
                    else if (currentVersionTags.filter(value => repoBranchesAndTags.includes(value)).length == 0) {
                        versionOldTags.get(image).push(currentVersionTags.join(","))
                    } else {
                        versionExistingTags.get(image).push(currentVersionTags.join(","))
                    }
                }))
            }
            if (!cleaned) {
                break
            }
        }
    }

    await Promise.all(images.map(async (image) => _cleanImageVersions(image)))

    console.log(
        "\n" +
        "NOTE: we keep these old tags but we could remove them\n" +
        "#####################################################\n" +
        JSON.stringify(Object.fromEntries(versionOldTags), null, 2)
    )
    console.log(
        "\n" +
        "We keep these recent tags\n" +
        "#########################\n" +
        JSON.stringify(Object.fromEntries(versionExistingTags), null, 2)
    )
}

/////////////
// Exports //
/////////////

export default {getImages, cleanRepo}
