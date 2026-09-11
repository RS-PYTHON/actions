// https://octokit.github.io/rest.js/v22/
// https://docs.github.com/en/rest/packages/packages?apiVersion=2026-03-10#list-packages-for-an-organization

import { Octokit } from "@octokit/rest";

todo read pat env var
const pat = ""
const org = "RS-PYTHON"
const package_type = "container"

function pushToMapArray(map, key, value) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
}

const octokit = new Octokit({ auth: pat});

// Get all container packages = docker images
var images = await octokit.paginate(octokit.rest.packages.listPackagesForOrganization, {
  package_type,
  org,
})

// Sort them by git repository and last update
let imagesByRepo = new Map()
let imagesByDate = new Map()
await images.forEach(p => {
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

const repo = "rs-client-libraries"
var images = imagesByRepo.get(repo)

// // Get all branches and tags of each git repository
// let repoBranchesAndTags = new Map()
// const repos = ["rs-server", "rs-demo"]
// await Promise.all(repos.map(async (repo) => {
//     repoBranchesAndTags.set(repo, [])
//     await octokit.paginate(octokit.rest.repos.listBranches, {owner: org, repo}).then(branches => {
//         branches.forEach(branch => repoBranchesAndTags.get(repo).push(branch.name))
//     })
//     await octokit.paginate(octokit.rest.repos.listTags, {owner: org, repo}).then(tags => {
//         tags.forEach(tag => repoBranchesAndTags.get(repo).push(tag.name))
//     })
// }))

// Get all branches and tags of the git repository
let repoBranchesAndTags = []
await octokit.paginate(octokit.rest.repos.listBranches, {owner: org, repo}).then(branches => {
    branches.forEach(branch => repoBranchesAndTags.push(branch.name))
})
await octokit.paginate(octokit.rest.repos.listTags, {owner: org, repo}).then(tags => {
    tags.forEach(tag => repoBranchesAndTags.push(tag.name))
})

// Docker image versions with no tag, or a tag from an old branch
let versionsNoTag = new Map()
let versionsOldTag = new Map()
await Promise.all(images.map(async (image) => {
    const versionPages = octokit.paginate.iterator(
        octokit.rest.packages.getAllPackageVersionsForPackageOwnedByOrg, {
          package_type,
          package_name: image,
          org
        })
    let v = []
    for await (const {data: versions} of versionPages) {

        // For each docker image version
        versions.forEach(version => {

            version_tags = version.metadata.container.tags

            version_tags.some(tag => repoBranchesAndTags.includes(tag))
        })
        v = versions
    }

    let bp = 0
}))



var bp = 0




// octokit.rest.packages.deletePackageVersionForOrg({
//   package_type,
//   package_name,
//   org,
//   package_version_id,
// });






var page = 0


// const packages = await octokit.rest.packages.listPackagesForOrganization({
//   package_type,
//   org,
// });

// // packages.data.forEach(item =>
// //     console.log(item.name)
// // );
// console.log(packages.data[0])

// const package_name = packages.data[1].name

// const versions = await octokit.rest.packages.getAllPackageVersionsForPackageOwnedByOrg({
//   package_type,
//   package_name,
//   org,
// });

// console.log(versions.data[0].metadata.container.tags)

// octokit.paginate(octokit.rest.packages.getAllPackageVersionsForPackageOwnedByOrg, {
//   package_type,
//   package_name,
//   org,
// })
//     .then(ps => {
//         console.log(ps)
//     })

// const bp= 0
