/*
Copyright (c) 2016-2017 Tyler Milford. All rights reserved.
This source code is subject to the terms of the Mozilla Public License, v. 2.0
as found in the LICENSE file or at: http://mozilla.org/MPL/2.0
*/

const {ipcRenderer, remote} = require('electron');

// select audio output device
let devices = [];

var vmDevices = new Vue({
    el: '#container',
    data: {
        devices: devices
    },
    methods: {
        attachDevice: function (device) {
            // attach device to media element
            // todo, get audio element from the main window? or set to DB and have DB listen?
            // mediaElement = ...
            //element.setSinkId(device.id).then(function() {console.log('woo!');}).catch(function(err) {console.error(err);});
            ipcRenderer.send('newDevice', device.id)
            remote.getCurrentWindow().hide();
        }
    }
});


function gotDevices(deviceInfos) {
    for(deviceInfo of deviceInfos) {
        if (deviceInfo.kind === 'audiooutput') {
            let device = {}
            device.id = deviceInfo.deviceId
            device.label = deviceInfo.label
            device.isSelected = false
            devices.push(device)
        }
    }
}

navigator.mediaDevices.enumerateDevices().then(gotDevices).catch(function(err) {console.error(err);});

ipcRenderer.on('settings', (event, arg) => {
    // clear selection
    for(device of devices) {
        device.isSelected = device.id == arg;
    }
});
