/*
Copyright (c) 2016-2017 Tyler Milford. All rights reserved.
This source code is subject to the terms of the Mozilla Public License, v. 2.0
as found in the LICENSE file or at: http://mozilla.org/MPL/2.0
*/

const {ipcRenderer, remote} = require('electron');
const fs = require('fs');
const path = require('path');
const glob = require('glob');
const async = require('async');
const mm = require('musicmetadata');
const Sortable = require('sortablejs');
const _ = require('underscore');

// setup DB
const dbSettings = new PouchDB('settings', {auto_compaction: true});
const dbLibrary = new PouchDB('library', {auto_compaction: true});
const dbHistory = new PouchDB('history', {auto_compaction: true});
const dbPlaylists = new PouchDB('playlists', {auto_compaction: true});

// app state

const extensions = ['.mp3', '.aiff', '.wav', '.mp4', '.aac', '.m4a', '.ogg', '.flac'];

const status = {
    nowPlaying: '',
    currentTrack: '',
    duration: '',
    currentTime: '',
    remainingTime: '',
    bitRate: '',
    seen: true,
    isActive: false,
    isPaused: false,
    playlistVisible: false,
    playlist: '',
    queuePosition: 0,
    libraryPath: '',
    libraryFolders: {name: "Library Folders", children: []}
};

// vue app
Vue.directive('sortable', {
    inserted: function (el, binding) {
        playlistSortable = Sortable.create(el, {
            group: "queue",
            ghostClass: 'activeDrag',
            chosenClass: 'activeDrag',
            dragClass: 'dragOverlay',
            // todo: migrate sort store from localStorage to pouchDB
            store: {
                get: function (sortable) {
                    let order = localStorage.getItem(sortable.options.group.name);
                    return order ? order.split('|') : [];
                },
                set: function (sortable) {
                    let order = sortable.toArray();
                    localStorage.setItem(sortable.options.group.name, order.join('|'));
                }
            },
            onSort: function (evt) {
                playlistSortable.save();
            },
        })
    }
});

const vmMain = new Vue({
    el: '#container',
    data: status
});


Vue.component('item', {
    template: '#item-template',
    props: {
        model: Object
    },
    data: function () {
        return {
            open: false
        }
    },
    computed: {
        isFolder: function () {
            return this.model.children &&
                this.model.children.length
        }
    },
    methods: {
        toggle: function () {
            if (this.isFolder) {
                this.open = !this.open
            }
        },
        play: function () {
            if (!this.isFolder) {
                //
            }
        }
    }
});

// audio media element
let audio = document.getElementById('currentTrack');

// load settings
dbSettings.info(function (err, info) {
    if (err) {
        console.error(err);
        return;
    }
    if (info.doc_count === 0) {
        // new setup
        const config = {
            "_id": "config",
            "libraryPath": remote.app.getPath('home'),
            "volume": 0.5,
            "balance": 0,
            "nowPlaying": 0,
            "outputDevice": "default"
        };
        const queue = {
            "_id": "queue",
            "tracks": []
        };
        dbSettings.put(config, function(err, response) {
            if (err) {
                console.error(err);
                return;
            }
            dbPlaylists.put(queue, function(err, response) {
                if (err) {
                    console.error(err);
                    return;
                }
                console.log("new setup! defaults loaded");
            });
        });
    } else {
        // restore saved settings
        dbSettings.get('config', function (err, doc) {
            if (err) {
                console.error(err);
            } else {
                // load settings into UI
                document.getElementById('vol').value = doc.volume;
                status.libraryPath = doc.libraryPath;
                gainNode.gain.value = scaleVolume(doc.volume);
                audio.setSinkId(doc.outputDevice).then(function(){}).catch(function(err) {console.error(err);});
                ipcRenderer.send('settings', doc.outputDevice);
                // populate library
                // todo support multiple root directories
                dirToJSON(status.libraryPath[0], function(err, res){
                    if(err)
                        console.error(err);

                    status.libraryFolders.children = res;
                });
            }
        });
        // load playlist
        dbPlaylists.get('queue', function (err, doc) {
            if (err) {
                console.error(err);
            } else {
                // load into UI
                // document.getElementById('vol').value = doc.volume;
                status.playlist = doc.tracks
                //console.log(doc.tracks);
            }
        });
    }
});

// received new settings from options window
ipcRenderer.on('newDevice', (event, arg) => {
    audio.setSinkId(arg).then(function(){}).catch(function(err) {console.error(err);});
    dbSettings.get('config', function (err, doc) {
        if (err) {
            console.error(err);
        } else {
            doc.outputDevice = arg;
            dbSettings.put(doc, function(err, response) {
                if (err) {
                    console.error(err);
                }
                ipcRenderer.send('settings', doc.outputDevice)
            });
        }
    });
});

// save settings on exit
window.onbeforeunload = function(e) {
    saveVol(document.getElementById('vol').value);
};

// library directory chooser
function setLibraryPath() {
    remote.dialog.showOpenDialog({
        title:'Add Music Library',
        defaultPath:remote.app.getPath('home'),
        properties:["openDirectory"]
    },function(filePath) {
        if(filePath) {
            dbSettings.get("config", function (err, doc) {
                if (err) {
                    console.error(err);
                    return
                }
                doc.libraryPath = filePath;
                dbSettings.put(doc, function (err, response) {
                    if (err) {
                        console.error(err);
                        return;
                    }
                    console.log("updated library path: " + response);
                    scanLibrary();
                });
            });
        }
    });
}

// scan library for music tracks
// todo: add btn to UI
function scanLibrary() {
    console.log("scanning library...");
    dbSettings.get("config", function (err, doc) {
        if (err) {
            console.error(err);
            return
        }
        // glob search -- [files] is an array of all track paths in the library
        let libraryPath = doc.libraryPath[0] + '/**/*.mp3';
        glob(libraryPath, function (err, files) {
            if (err) {
                console.error(err);
            }
            readMetaData(files);
        });
    });
}

function dirToJSON (dir, cb) {
    let results = [];

    fs.readdir(dir, function(err, list) {
        if (err)
            return cb(err);

        let pending = list.length;

        if (!pending)
            return cb(null, {name: path.basename(dir), type: 'folder', children: results});

        list.forEach(function(file) {
            file = path.resolve(dir, file);
            fs.stat(file, function(err, stat) {
                if (stat && stat.isDirectory()) {
                    dirToJSON(file, function(err, res) {
                        results.push({
                            name: path.basename(file),
                            children: res
                        });
                        if (!--pending)
                            cb(null, results);
                    });
                }
                else {
                    if (extensions.indexOf(path.extname(file).toLowerCase()) !== -1) {
                        results.push({
                            name: path.basename(file)
                        });
                    }
                    if (!--pending)
                        cb(null, results);
                }
            });
        });
    });
}


// read ID3 tags
function readMetaData(tracks) {
    console.log("reading metadata...");
    let pendingTracks = [];
    // limit of 10 worked well on my system, but worth testing further
    async.eachLimit(tracks, 10, function(item, cb) {
        let readableStream = fs.createReadStream(item);
        mm(readableStream, function (err, metadata) {
            readableStream.close();
            if(err) {
                cb(null);
                return;
            }
            pendingTracks.push({
                "_id": item,
                "dateAdded": new Date().toISOString(),
                "playCount": 0,
                "artist": metadata.artist[0] || '',
                "albumartist": metadata.albumartist[0] || "",
                "album": metadata.album || "",
                "title": metadata.title || "",
                "year": metadata.year || "",
                "track": metadata.track.no || "",
                "genre": metadata.genre[0] || "",
                "order": ""
            });
            cb()
        })
    }, function(err) {
        if(err) {
            console.error(err);
        }
        // sort by path
        _.sortBy(pendingTracks, "_id");

        // assign a sort order index
        for(let i in pendingTracks) {
            pendingTracks[i].order = i
        }

        // done fetching metadata; update library database
        updateLibrary(pendingTracks);
    })
}

// add tracks to library db
function updateLibrary(tracks) {
    console.log("updating library db...");
    dbLibrary.bulkDocs(tracks, function (err, result) {
        if (err) {
            return console.error(err);
        }
        console.log("database updated!");
        // lets add the whole library to the queue for giggles
        //todo: restore this
        dbPlaylists.get('queue', function (err, doc) {
            if (err) {
                console.error(err);
            } else {
                doc.tracks = tracks;
                dbPlaylists.put(doc, function (err, response) {
                    if (err) {
                        console.error(err);
                        return;
                    }
                    console.log("updated playlist!");
                });
            }
        });
    });
}

// logarithmic volume scale
function scaleVolume(position) {
    if(position <= 10) {
        return 0;
    }
    // input position between 1 and 1000
    const minp = 1;
    const maxp = 1000;

    // output should be between 0.001 and 1
    const minv = Math.log(0.001);
    const maxv = Math.log(1);

    // calculate adjustment factor
    const scale = (maxv-minv) / (maxp-minp);

    return Math.exp(minv + scale*(position-minp));
}

function setVol(val) {
    //audio.volume = val;
    //let dBFS = 20 * Math.log10(gain);
    gainNode.gain.value = scaleVolume(val);
}

// save volume to db
function saveVol(vol) {
    dbSettings.get('config', function (err, doc) {
        if (err) {
            console.error(err);
        } else {
            doc.volume = vol;
            dbSettings.put(doc, function(err, response) {
                if (err) {
                    console.error(err);
                }
                // settings saved
            });
        }
    });
}

function setBalance(val) {
    panNode.pan.value = val;
}

function play(track) {
    // clear prev
    audio.src = '';
    audio.load();

    // get metadata from queue state

    let trackMeta = status.playlist.find(function(playlist) {
        return playlist._id === track._id
    });

    // load metadata into UI
    status.currentTrack = track._id;
    status.nowPlaying = trackMeta.artist === '' ? path.basename(trackMeta._id) : trackMeta.artist + " - " + trackMeta.title + " (" + trackMeta.album + ")";
    ipcRenderer.send('tooltip', status.nowPlaying);

    // play track
    audio.src = track._id;
    audio.play();

    document.getElementById("albumart").style.backgroundImage = 'url("' + getArt(track._id) + '")';

    // update history db
    //updateHistory({"_id":track._id,"lastPlayed":new Date().toISOString()});
}


function getArt(dir) {
    const supportedFiles = [
        'albumart.png',
        'album.png',
        'albumart.jpg',
        'albumart.jpeg',
        'album.jpg',
        'album.jpeg',
        'cover.png',
        'cover.jpg',
        'cover.jpeg'
    ];
    let art = '';
    let rootDir = path.dirname(dir);
    for (let i=0; i < supportedFiles.length; i++) {
        try {
            if (fs.statSync(path.join(rootDir, supportedFiles[i])).isFile()) {
                art = path.join(rootDir, supportedFiles[i]);
                break;
            }
        }
        catch (e) {
        }
    }
    console.log(art);
    return art;
}


function next() {
    // clear prev
    audio.src = '';
    audio.load();

    let trackIndex = status.playlist.findIndex(function(playlist) {
        return playlist._id === status.currentTrack
    });

    let nextTrack = status.playlist[trackIndex+1];

    status.currentTrack = nextTrack._id;
    status.nowPlaying = nextTrack.artist === '' ? path.basename(nextTrack._id) : nextTrack.artist + " - " + nextTrack.title + " (" + nextTrack.album + ")";
    ipcRenderer.send('tooltip', status.nowPlaying);

    audio.src = nextTrack._id;
    audio.play();

}

function playPause() {
    if(status.isActive) {
        audio.pause();
        Object.assign(status, {isPaused: true, isActive: false})
    }
    else if(audio.src) {
        audio.play();
        Object.assign(status, {isPaused: false, isActive: true})
    }
}

function mute() {
    // slowly restore volume
    //gainNode.gain.linearRampToValueAtTime(VOL, audioCtx.currentTime + 2);
}


audio.onended = function() {
    status.isActive = false;
    playRandom()
};


function prettyTime(s) {
    // assumes duration is positive
    let min = Math.floor(s/60);
    let sec = Math.floor(s%60);
    let ms = Math.floor((s*1000)%1000);
    return ("00" + min).slice(-2) + ":" + ("00" + sec).slice(-2) + ":" + (ms + "000").slice(0,3);
}

// return path str without the "file://" prefix
function trimFilePrefix(path) {
    if (process.platform === 'darwin') {
        return decodeURIComponent((audio.src).slice(7));
    }
    return decodeURIComponent((audio.src).slice(8));
}

// calculate bitrate from track length and filesize
function getBitRate() {
    const track = trimFilePrefix(audio.src);
    fs.stat(track, function(err, stats) {
        if(err) {
            console.log(err);
            return;
        }
        // bytes -> kilobits per second
        const bytes = stats.size;
        const bits = bytes * 8;
        const kbits = bits / 1000;
        const s = audio.duration;
        const bitrate = kbits/s;
        status.bitRate = Math.floor(bitrate) + 'kbps'
    });
}

audio.onloadedmetadata = function() {
    status.duration = prettyTime(audio.duration);
    getBitRate()
};


audio.onplay = function(){
    status.isActive = true
};

function playRandom() {
    dbLibrary.allDocs(function(err, result) {
        if(err) {
            console.error(err);
            return;
        }
        avoidHistory(result.rows);
    });

    function avoidHistory(result) {
        // avoid tracks in history
        // todo: make toggleable; reset once history == db
        if(result.length === 0) {
            return;
        }
        let i = Math.floor((Math.random() * result.length));
        let randomSong = result[i].id;
        result.splice(i, 1);
        dbHistory.get(randomSong, function(err, doc) {
            if (err) {
                audio.src = randomSong;
                //status.isActive = true;
                dbLibrary.get(randomSong, function(err, doc) {
                    if(err) {
                        console.error(err);
                        return;
                    }
                    if (doc.artist === '') {
                        status.nowPlaying = path.basename(doc._id)
                    } else {
                        status.nowPlaying = doc.artist + " - " + doc.title + " (" + doc.album + ")";
                    }
                    ipcRenderer.send('tooltip', doc.artist + " - " + doc.title)
                });
                audio.play();
                // add track to history db
                updateHistory({"_id":randomSong,"lastPlayed":new Date().toISOString()});
                return;
            }
            avoidHistory(result)
        })
    }
}

function updateHistory(track) {
    dbHistory.put(track, function(err, response) {
        if (err) {
            console.error(err);
        }
    });
}

function playNext(t) {
    console.log(t._id);
    audio.src = '';
    audio.load();
    let i = Math.floor((Math.random() * status.playlist.length));
    let randomSong = status.playlist[i]._id;
    status.currentTrack = randomSong;
    status.nowPlaying = status.playlist[i].artist + " - " + status.playlist[i].title;
    audio.src = randomSong;
    audio.play();
}


// web audio stuff
// note the mixed contexts: we can play/pause thru the media element, and have its output routed into the processing
// graph of the web audio context

// audio context (container)
const audioCtx = new window.AudioContext();

// audio input
const source = audioCtx.createMediaElementSource(audio);

// other audio nodes
const gainNode = audioCtx.createGain();
const panNode = audioCtx.createStereoPanner();
const analyser = audioCtx.createAnalyser();

// analyser
analyser.fftSize = 2048;
let bufferLength = analyser.frequencyBinCount;
let dataArray = new Uint8Array(bufferLength);

const canvas = document.getElementById("canvas");
const canvasCtx = canvas.getContext("2d");

canvasCtx.clearRect(0, 0, 600, 600);

function draw() {
    if(audio.duration && audio.currentTime) {
        status.remainingTime = "-" + prettyTime(audio.duration - audio.currentTime);
    }

    drawVisual = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArray);
    canvasCtx.clearRect(0, 0, 600, 600);
    let barWidth = (600 / bufferLength) *1.6;
    let barHeight;
    let x = 0;

    for(let i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i];
        canvasCtx.fillStyle = 'rgba(' + 65 + ',' + 255 + ',200,' + barHeight/100 + ')';
        canvasCtx.fillRect(x,200-barHeight/2,barWidth,barHeight);
        x += 2;
    }
}

draw();


// wire nodes together
// todo: toggle analysis pre/post effects nodes (ie gain before analysis)
source.connect(analyser);
analyser.connect(gainNode);
gainNode.connect(panNode);
panNode.connect(audioCtx.destination);
