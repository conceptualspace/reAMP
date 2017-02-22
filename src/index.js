/*
Copyright (c) 2016-2017 Tyler Milford. All rights reserved.
This source code is subject to the terms of the Mozilla Public License, v. 2.0
as found in the LICENSE file or at: http://mozilla.org/MPL/2.0
*/

// supported formats (ideally)
// MP3, AIFF, WAV, MPEG-4, AAC, M4A, OGG, FLAC

const {remote} = require('electron');
const fs = require('fs');
const path = require('path');
const glob = require('glob');
const async = require('async');
const mm = require('musicmetadata');
var _ = require('underscore');

// setup DB
const dbSettings = new PouchDB('settings', {auto_compaction: true});
const dbLibrary = new PouchDB('library', {auto_compaction: true});
const dbHistory = new PouchDB('history', {auto_compaction: true});

// windoze paths (actually electron seems to handle these OK... todo delete me?)
function cleanPath(path) {
    var regex = /\//g;
    return dir.replace(regex, "\\\\");
}

// load default settings
dbSettings.info(function (err, info) {
    if (err) {
        console.error(err);
        return;
    }
    if (info.doc_count == 0) {
        // new setup
        var config = {
            "_id": "config",
            "libraryPath": remote.app.getPath('home'),
            "volume": 0.5,
            "nowPlaying": 0
        };
        dbSettings.put(config, function(err, response) {
            if (err) {
                console.error(err);
                return;
            }
            console.log("new setup! defaults loaded");
        });
    } else {
        // restore saved settings
        dbSettings.get('config', function (err, doc) {
            if (err) {
                console.error(err);
            } else {
                // TODO: update ui
                //setVol(doc.volume)
                document.getElementById('vol').value = doc.volume
            }
        });
    }
});


// directory chooser
function setLibraryPath() {
    remote.dialog.showOpenDialog({title:'Add Music Library', defaultPath:remote.app.getPath('home'), properties:["openDirectory"]}, function(filePath) {
        if(filePath) {
            dbSettings.get("config", function (err, doc) {
                if (err) {
                    alert(err);
                    return
                }
                doc.libraryPath = filePath;
                console.log(filePath);
                dbSettings.put(doc, function (err, response) {
                    if (err) {
                        alert(err);
                        return;
                    }
                    console.log("updated library path: " + response);
                    scanLibrary();
                });
            });
        }
    });
}

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

function readMetaData(tracks) {
    console.log("reading metadata...");
    var pendingTracks = [];
    async.eachLimit(tracks, 10, function(item, cb) {
        let readableStream = fs.createReadStream(item);
        let parser = mm(readableStream, function (err, metadata) {
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
                "genre": metadata.genre[0] || ""
            });
            cb()
        })
    }, function(err) {
        // done fetching metadata
        if(err) {
            console.error(err);
        }
        // update library database
        updateLibrary(pendingTracks);
    })
}

function updateLibrary(tracks) {
    console.log("updating library db...");
    dbLibrary.bulkDocs(tracks, function (err, result) {
        if (err) {
            return console.error(err);
        }
        console.log("database updated!")
    });
}

// slowly restore volume
//gainNode.gain.linearRampToValueAtTime(VOL, audioCtx.currentTime + 2);

window.onbeforeunload = function(e) {
    saveVol(document.getElementById('vol').value);
};

// todo: display vol in dBFS (and set a stop at 1 on the input slider)
//let dbfs = 20 * Math.log10(gain);

// logarithmic volume
// todo make this a hybrid
function scaleVolume(position) {
    if(position <= 10) {
        return 0;
    }
    // input position between 1 and 1000
    var minp = 1;
    var maxp = 1000;

    // output should be between 0.001 and 1
    var minv = Math.log(0.001);
    var maxv = Math.log(1);

    // calculate adjustment factor
    var scale = (maxv-minv) / (maxp-minp);

    return Math.exp(minv + scale*(position-minp));
}

function setVol(val) {
    //audio.volume = val;
    gainNode.gain.value = scaleVolume(val);
}

function saveVol(vol) {
    console.log("saving vol");
    dbSettings.get('config', function (err, doc) {
        if (err) {
            console.error(err);
        } else {
            console.log(doc);
            doc.volume = vol;
            console.log(doc);
            dbSettings.put(doc, function(err, response) {
                if (err) {
                    console.error(err);
                    return;
                }
                console.log("settings updated")
            });
        }
    });
}

function setBalance(val) {
    if(val < 600 && val > 400) {
        document.getElementById('balance').value = 500;
    }
    // todo: apply balance
}

function playPause() {
    if(status.isActive) {
        audio.pause()
        status.isPaused = true;
        status.isActive = false;
    }
    else if(audio.src) {
        audio.play();
        status.isPaused = false;
        status.isActive = true;
    }
}

let audio = document.getElementById('currentTrack');
let song= '';
let status = {
    nowPlaying: '',
    duration: '',
    currentTime: '',
    remainingTime: '',
    bitRate: '',
    seen: true,
    isActive: false,
    isPaused: false
};


audio.onended = function() {
    status.isActive = false;
    playRandom()
};


function prettyTime(s) {
    let minutes = Math.floor(s / 60);
    let seconds = ("00" + Math.floor(s % 60)).slice(-2);
    return minutes + ":" + seconds;
}

function getBitRate() {
    var track = decodeURIComponent((audio.src).slice(7));
    fs.stat(track, function(err, stats) {
        if(err) {
            console.log(err);
            return;
        }
        // bytes -> kilobits per second
        var bytes = stats.size;
        var bits = bytes * 8;
        var kbits = bits / 1000;
        var s = audio.duration;
        var bitrate = kbits/s;
        status.bitRate = Math.floor(bitrate) + 'kbps'
    });
}

function remainingTime(elapsed, total) {
    s = total - elapsed
    return "-" + prettyTime(s)
}


audio.onloadedmetadata = function() {
    status.duration = prettyTime(audio.duration);
    getBitRate()
};

audio.ontimeupdate = function() {
    status.currentTime = prettyTime(audio.currentTime);
    status.remainingTime = remainingTime(audio.currentTime, audio.duration)
};

audio.onplay = function(){
    status.isActive = true
};

function playRandom() {
    console.log("playing random track...");
    dbLibrary.allDocs(function(err, result) {
        avoidHistory(result.rows);
    });

    function avoidHistory(result) {
        // avoid tracks in history
        // todo: make toggleable; reset once history == db
        if(result.length == 0) {
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
                    status.nowPlaying = doc.artist + " - " + doc.title + " (" + doc.album + ")";
                });
                audio.play();
                // add track to history db
                updateHistory({"_id":randomSong,"lastPlayed":new Date().toISOString()})
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


// html media element
//let song = '/Users/tyler/Music/test.mp3';
//var song = 'D:\\Music\\!MISC\\02 - bait for dub.mp3';

//let audio = new Audio(song);
//audio.play();

var appStatus = new Vue({
    el: '#status',
    data: status
});

var vmDuration = new Vue({
    el: '#duration',
    data: status
})

var playButton = new Vue({
    el: '#playBtn',
    data: status
});

// web audio stuff (we can still play/pause thru the media element, and have its output routed into the processing
// graph of the audio context!


// audio context (container)
var audioCtx = new window.AudioContext();

// audio input
var source = audioCtx.createMediaElementSource(audio);

// other audio nodes
var gainNode = audioCtx.createGain();

var analyser = audioCtx.createAnalyser();
analyser.fftSize = 2048;
var bufferLength = analyser.frequencyBinCount;
var dataArray = new Uint8Array(bufferLength);

var canvas = document.getElementById("canvas");
var canvasCtx = canvas.getContext("2d");

canvasCtx.clearRect(0, 0, 600, 600);

function draw() {
    drawVisual = requestAnimationFrame(draw);

    analyser.getByteFrequencyData(dataArray);

    canvasCtx.fillStyle = 'rgb(0, 0, 0)';
    canvasCtx.fillRect(0, 0, 600, 600);

    var barWidth = (600 / bufferLength) *1.6;
    var barHeight;
    var x = 0;

    for(var i = 0; i < bufferLength; i++) {
        barHeight = dataArray[i];

        canvasCtx.fillStyle = 'rgba(' + 65 + ',' + 255 + ',200,' + barHeight/100 + ')';
        canvasCtx.fillRect(x,200-barHeight/2,barWidth,barHeight);

        x += 2;
    }


}

draw();



// wire them together
source.connect(analyser);
analyser.connect(gainNode);

// audio output
//gainNode.connect(audioCtx.destination);
//gainNode.connect(analyser);
gainNode.connect(audioCtx.destination);
