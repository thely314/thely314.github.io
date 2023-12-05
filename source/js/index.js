var song_list=["果てなき風の軌跡さえ~破~","琪露诺的完美算术教室","琪露诺的完美算数教室⑨周年版","NEEDY GIRL OVERDOSE","INTERNET YAMERO","二人の魔法","Sweet Treasure (Inst.)"];
var i = 0;

var audioPlayer = document.getElementById("audioPlayer");

//初始化音量
window.onload = function() {
    var audio = document.getElementById("audioPlayer");
    audio.volume = 0.2;
};

function play() {
    if (audioPlayer.paused) {
        audioPlayer.play();
        document.getElementById('musicImg').src="source/img/pauseButton.png";
    }else{
        audioPlayer.pause();
        document.getElementById('musicImg').src="source/img/startButton.png";
    }
}

function end() {
  audioPlayer.pause();
  document.getElementById('musicImg').src="source/img/startButton.png";
  audioPlayer.currentTime = 0;//让音乐从头播放
}

function change(n){
    i=n;
    audioPlayer.src = "source/music/"+song_list[i]+".mp3";
    audioPlayer.load();
    audioPlayer.play();
    document.getElementById('musicImg').src="source/img/pauseButton.png";
    changeShowedText(i);
}

function next(){
    if(i<6)//n-1
    {
       i+=1;
    }
    else{
       i=0;
    }
    audioPlayer.src = "source/music/"+song_list[i]+".mp3";
    audioPlayer.load();
    audioPlayer.play();
    document.getElementById('musicImg').src="source/img/pauseButton.png";
    changeShowedText(i);
}

function changeVolume(value) {
    var audio = document.getElementById("audioPlayer");
    audio.volume = value;
    
    var volumeLabel = document.getElementById("volumeLabel");
    volumeLabel.innerText = "音量: " + (value * 100) + "%";
}

function changeShowedText(i){
    var showedText = document.getElementById("currentMusic");
    showedText.innerText = "当前播放: " + song_list[i];
}
