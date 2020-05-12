#!/bin/bash
sudo apt update
sudo apt install ruby ruby-dev
sudo gem install package_cloud
npm ci
echo "\
always-auth=true
registry=https://packagecloud.io/rrooij/development/npm/
//packagecloud.io/rrooij/development/npm/:_authToken=$PACKAGECLOUD_API_TOKEN
" > $TRAVIS_BUILD_DIR/.npmrc
VERSION=$(cat package.json | jq '.version' | sed 's/"//g')
package_cloud yank rrooij/development/node "@terminusdb/terminusdb-client-$VERSION.tgz"
npm publish
