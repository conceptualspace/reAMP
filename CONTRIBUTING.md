# Contributing

### Install and run from source

reAMP requires a recent version of Node.js. Then run the following:
```
git clone https://github.com/conceptualspace/reAMP
cd reAMP
npm install
electron .
```

### Building
`npm run dist`
*(must be run from each target OS)*

### Release Workflow
##### Version release
A release branch is created from develop. When ready for release, it is merged into master and tagged. Master is then merged back into develop

1. Create release branch:
```
git checkout develop
git pull --rebase
git checkout -b release-vX.X.X develop
git push -u origin release-vX.X.X
```
2. (do stuff -- ie bump version in package.json)

3. When release branch is ready:
```
git checkout master
git pull --rebase
git merge --no-ff release-vX.X.X
git tag -a vX.X.X
git push
git push --tags
git branch -d release-vX.X.X
git checkout develop
git merge --no-ff develop
git push
```
