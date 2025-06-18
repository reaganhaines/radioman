async function init() {
  // Get an ephemeral key from your server - see server code below
  const tokenResponse = await fetch("/session");
  const data = await tokenResponse.json();
  const EPHEMERAL_KEY = data.client_secret.value;

  // Create a peer connection
  const pc = new RTCPeerConnection();

  // Set up to play remote audio from the model
  const audioEl = document.createElement("audio");
  audioEl.autoplay = true;
  pc.ontrack = e => audioEl.srcObject = e.streams[0];

  // Add local audio track for microphone input in the browser
  const ms = await navigator.mediaDevices.getUserMedia({
    audio: true
  });
  const micTrack = ms.getTracks()[0];
  pc.addTrack(micTrack);

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
      icon.className = "fa-solid fa-microphone";
      muteBtn.setAttribute("tooltip", "Mute");
    } else {
      icon.className = "fa-solid fa-microphone-slash";
      muteBtn.setAttribute("tooltip", "Unmute")
    }
  });

  // Set up data channel for sending and receiving events
  const dc = pc.createDataChannel("oai-events");
  dc.addEventListener("message", async (e) => {
    console.log(e);
    try {
      const data = JSON.parse(e.data);

      // Handle user transcript
      if (data.type === "conversation.item.input_audio_transcription.completed") {
        addMessageToConversation("user", data.transcript);
      }

      // Handle assistant response
      if (data.type === "response.done" && data.response?.output?.length) {
        const output = data.response.output[0];
        if (
          output.type === "message" &&
          output.role === "assistant" &&
          output.content?.length
        ) {
          // Find the transcript in the content array
          const transcriptObj = output.content.find(
            (c: any) => c.type === "audio" && c.transcript
          );
          if (transcriptObj) {
            addMessageToConversation("assistant", transcriptObj.transcript);
          }
        }
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

  // Helper function to add a message to the conversation list
  function addMessageToConversation(role: "user" | "assistant", text: string) {
    const list = document.getElementById("conversation-list");
    if (!list) return;

    const msgDiv = document.createElement("div");
    msgDiv.className = `message ${role}`;

    const header = document.createElement("div");
    header.className = "message-header";
    header.textContent = role === "user" ? "User's message" : "Assistant's message";

    const textDiv = document.createElement("div");
    textDiv.className = "message-text";
    textDiv.textContent = text;

    msgDiv.appendChild(header);
    msgDiv.appendChild(textDiv);
    list.appendChild(msgDiv);

    // Optionally scroll to bottom
    list.scrollTop = list.scrollHeight;
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

init();