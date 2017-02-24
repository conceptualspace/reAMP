/*
 Copyright (c) 2016-2017 Tyler Milford. All rights reserved.
 This source code is subject to the terms of the Mozilla Public License, v. 2.0
 as found in the LICENSE file or at: http://mozilla.org/MPL/2.0
 */

const {app, BrowserWindow, ipcMain, Menu, Tray} = require('electron');
const path = require('path');
const url = require('url');

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let win;
let tray;

function createWindow () {
    // Create the browser window.
    win = new BrowserWindow({
        width: 460,
        height: 500,
        useContentSize: true,
        frame: false,
        transparent: true,
        backgroundColor: '#000000'
    });

    // and load the index.html of the app.
    win.loadURL(url.format({
        pathname: path.join(__dirname, 'index.html'),
        protocol: 'file:',
        slashes: true
    }));

    win.focus();

    // Emitted when the window is closed.
    win.on('closed', () => {
        win = null
    })

    tray = new Tray('build/icon.png');
    const contextMenu = Menu.buildFromTemplate([
        {label: 'reAMP...'},
        {type: 'separator'},
        {label: 'Settings...', click: function() {  optionsWin.show(); }},
        {type: 'separator'},
        {label: 'Quit', click: function() { app.quit(); win.destroy(); }}
    ]);
    tray.setToolTip('reAMP');
    tray.setContextMenu(contextMenu);

    tray.on('click', function() {
        win.show();
    });

    // options window
    let optionsWin = new BrowserWindow({
        show: false,
        frame: false,
        modal: true,
        parent: win,
        transparent: true,
        resizable: false,
        width: 460,
        height: 400,
        useContentSize: true
    });
    optionsWin.loadURL(url.format({
        pathname: path.join(__dirname, 'options.html'),
        protocol: 'file:',
        slashes: true
    }));

    optionsWin.on('closed', () => {
        optionsWin = null
    })

    // Open DevTools.
    win.webContents.openDevTools();
    optionsWin.webContents.openDevTools();

    // listeners

    ipcMain.on('message', (event, arg) => {
        if (arg == 'showOptions') {
            optionsWin.show();
        }
        //event.sender.send('message', 'reply')
    })

    ipcMain.on('settings', (event, arg) => {
        //event.sender.send('settings', arg)
        optionsWin.webContents.send('settings', arg);
    })

    ipcMain.on('newDevice', (event, arg) => {
        //event.sender.send('settings', arg)
        win.webContents.send('newDevice', arg);
    })
}


app.on('ready', createWindow);

// Quit when all windows are closed.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
    }
});

app.on('activate', () => {
    if (win === null) {
        createWindow();
        return
    }
    win.show();
    win.focus();
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.