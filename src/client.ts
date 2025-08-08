let pc: RTCPeerConnection;
let dc: RTCDataChannel;
let micTrack: MediaStreamTrack;
let audioEl: HTMLAudioElement;

async function setUpPC(EPHEMERAL_KEY: string) {
  console.log("Setting up peer connection...");
  pc = new RTCPeerConnection();

  // Set up to play remote audio from the model
  audioEl = document.createElement("audio");
  audioEl.autoplay = true;
  pc.ontrack = e => audioEl.srcObject = e.streams[0];

  // Add local audio track for microphone input in the browser
  const ms = await navigator.mediaDevices.getUserMedia({
    audio: true
  });
  micTrack = ms.getTracks()[0];
  pc.addTrack(micTrack);

  // Set up data channel for sending and receiving events
  const dc = pc.createDataChannel("oai-events");
  dc.addEventListener("message", async (e) => {
    console.log(e);
    try {
      const data = JSON.parse(e.data);
      
      if (data.type === "input_audio_buffer.speech_started") {
        const muteBtn = document.getElementById("mute-btn");
        if (muteBtn) {
          const icon = muteBtn.querySelector("i");
          if (icon) icon.classList.add("mic-active");
        }
      }

      if (data.type === "input_audio_buffer.speech_stopped") {
        const muteBtn = document.getElementById("mute-btn");
        if (muteBtn) {
          const icon = muteBtn.querySelector("i");
          if (icon) icon.classList.remove("mic-active");
        }
      }

      if(data.type === "conversation.item.created" && data.item.type === "message") {
        insertMessage(data)
      }

      if(data.type === "conversation.item.input_audio_transcription.completed") {
        updateMessage(data.item_id, data.transcript)
      }

      if(data.type === "response.audio_transcript.delta") { 
        updateMessage(data.item_id, data.delta)
      }

      if (data.type === "response.done") {
        const output = data.response.output[0]
        if (
          output.type === "function_call" &&
          output.name === "web_search" &&
          output.arguments?.length
        ) {
          const args = JSON.parse(output.arguments);
          const resp = await fetch(`/web?q=${encodeURIComponent(args.question)}`);
          const webResult = await resp.json();
          const reply = {
            type:"conversation.item.create",
            item:{
              type: "function_call_output",
              call_id: output.call_id,
              output: JSON.stringify(webResult)
            }
          }
          dc.send(JSON.stringify(reply));
          dc.send(JSON.stringify({type: "response.create"}));
        }
      }
      

      if (data.type === "rate_limits.updated") {
        const tokensLimit = data.rate_limits.find((rl: any) => rl.name === "tokens");
        if (tokensLimit) {
          const tokenText = document.getElementById("token-limit-text");
          if(tokenText) {
            tokenText.textContent = `Tokens Remaining: ${tokensLimit.remaining} / ${tokensLimit.limit}`;
          }
          const tokenBar = document.getElementById("token-limit-bar");
          if(tokenBar){
            tokenBar.style.width = tokensLimit.remaining * 100 / tokensLimit.limit + "%";
          }
        }
      }
    } catch (err) {
      console.error("Failed to parse message:", e.data, err);
    }
  });

  interface conversationMessage {
    type: string;
    event_id: string;
    previous_item_id: string | null;
    item: {
      id: string;
      object: string;
      type: string;
      status: string;
      role: "user" | "assistant";
      content: [{
          type: string;
          transcript: string | null;
        }
      ];
    }
  }

  function insertMessage(data: conversationMessage){
    const list = document.getElementById("conversation-list");
    const msgDiv = document.createElement("div");
    msgDiv.className = `message ${data.item.role}`;
    msgDiv.id = data.item.id;
    
    const header = document.createElement("div");
    header.className = "message-header";
    header.textContent = data.item.role === "user" ? "User's message" : "Assistant's message";

    const textDiv = document.createElement("div");
    textDiv.className = "message-text";

    const loadingSpan = document.createElement("span");
    loadingSpan.className = "ellipsis-loader";

    msgDiv.appendChild(header);
    msgDiv.appendChild(textDiv);
    textDiv.appendChild(loadingSpan);
    list?.appendChild(msgDiv);
  }

  function updateMessage(item_id: string, delta: string | undefined) {
    const msgDiv = document.getElementById(item_id);
    if(!msgDiv) return;
    const textDiv = msgDiv.querySelector(".message-text");
    if(!textDiv) return;

    const loader = textDiv.querySelector(".ellipsis-loader");
    if(loader) loader.remove();

    textDiv.textContent = (textDiv.textContent ?? "") + (delta ?? "");
  }

  // Start the session using the Session Description Protocol (SDP)
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const baseUrl = "https://api.openai.com/v1/realtime";
  const model = "gpt-4o-realtime-preview-2024-12-17";
  const sdpResponse = await fetch(`${baseUrl}?model=${model}`, {
    method: "POST",
    body: offer.sdp,    
    headers: {
      Authorization: `Bearer ${EPHEMERAL_KEY}`,
      "Content-Type": "application/sdp"
    },
  });

  const answer: RTCSessionDescriptionInit = {
    type: "answer",
    sdp: await sdpResponse.text(),
  };
  await pc.setRemoteDescription(answer);

  const sessionInit = {
    type: "session.update",
    session: {
      instructions: "You are a talk show sidekick named Chad. You will respond to the host's questions in humorous, witty, and slightly ignorant but charming ways. You should interject somewhat infrequently, but when you do, your responses should be short and to the point. You should also use a friendly and casual tone.",
      voice: "verse",
      turn_detection: {
        type: "semantic_vad",
        eagerness: "low",
        create_response: true,
        interrupt_response: true
      },
      input_audio_transcription: {
        model: "whisper-1"
      },
      tools: [
        {
          type: "function",
          name: "web_search",
          description: "Search the web for information to answer the user's questions.",
          parameters: {
            type: "object",
            properties: {
              question: {type: "string"}
            },
            required: ["question"]
          }
        }
      ]
    }
  }
  dc.addEventListener("open", () => {
    dc.send(JSON.stringify(sessionInit));
  });
}

async function stopConnection() {
  if (pc) {
    pc.ontrack = null;
    pc.onicecandidate = null;
    pc.close();
  }
  if (micTrack) {
    micTrack.stop();
  }
  if (audioEl) {
    audioEl.srcObject = null;
  }
}

async function init() {
  // Get an ephemeral key from your server - see server code below
  const tokenResponse = await fetch("/session");
  const data = await tokenResponse.json();
  const EPHEMERAL_KEY = data.client_secret.value;

  await setUpPC(EPHEMERAL_KEY);
  
  const volumeSlider = document.getElementById("volume-slider") as HTMLInputElement;
  const volumeMuteBtn = document.getElementById("volume-mute-btn") as HTMLButtonElement;
  const volumeIcon = document.getElementById("volume-icon") as HTMLElement;
  let previousVolume = Number(volumeSlider?.value) || 50;

  if (volumeSlider) {
    audioEl.volume = Number(volumeSlider.value) / 100;
    volumeSlider.addEventListener("input", () => {
      audioEl.volume = Number(volumeSlider.value) / 100;
      // Update icon based on volume
      if (Number(volumeSlider.value) === 0) {
        volumeIcon.classList.remove("fa-volume-high");
        volumeIcon.classList.add("fa-volume-xmark");
      } else {
        volumeIcon.classList.remove("fa-volume-xmark");
        volumeIcon.classList.add("fa-volume-high");
        previousVolume = Number(volumeSlider.value);
      }
    });
  }

  if (volumeMuteBtn && volumeSlider) {
    volumeMuteBtn.addEventListener("click", () => {
      if (Number(volumeSlider.value) === 0) {
        // Unmute: restore previous volume
        volumeSlider.value = previousVolume.toString();
        audioEl.volume = previousVolume / 100;
        volumeIcon.classList.remove("fa-volume-xmark");
        volumeIcon.classList.add("fa-volume-high");
      } else {
        // Mute: set to 0
        previousVolume = Number(volumeSlider.value);
        volumeSlider.value = "0";
        audioEl.volume = 0;
        volumeIcon.classList.remove("fa-volume-high");
        volumeIcon.classList.add("fa-volume-xmark");
      }
    });
  }


  const muteBtn = document.getElementById("mute-btn");
  if (!muteBtn) {
    console.error("Mute button not found");
    return;
  }
  muteBtn.addEventListener("click", () => {
    micTrack.enabled = !micTrack.enabled;
    const icon = muteBtn.querySelector("i");
    if (!icon) {
      console.error("Mute button icon not found");
      return;
    }
    if (micTrack.enabled) {
      icon.classList.remove("fa-microphone-slash");
      icon.classList.add("fa-microphone");
      muteBtn.setAttribute("tooltip", "Mute");
    } else {
      icon.classList.remove("fa-microphone");
      icon.classList.add("fa-microphone-slash");
      muteBtn.setAttribute("tooltip", "Unmute");
    }
  });

  
  const stopButton = document.getElementById("stop-btn");
  const startStopIcon = stopButton?.querySelector("i");
  if(stopButton) {
    stopButton.addEventListener("click", async () => {
      if (pc?.connectionState === "connected") {
        stopConnection();
        startStopIcon?.classList.replace("fa-stop", "fa-play");
        console.log("Connection closed by user.");
      } else {
        stopConnection(); 
        await setUpPC(EPHEMERAL_KEY);
        audioEl.volume = Number(volumeSlider.value) / 100;
        micTrack.enabled = muteBtn.getAttribute("tooltip") === "Mute";
        startStopIcon?.classList.replace("fa-play", "fa-stop");
        console.log("Connection started by user.");
      }
    });
  }
}

init();