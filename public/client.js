"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
function init() {
    return __awaiter(this, void 0, void 0, function* () {
        // Get an ephemeral key from your server - see server code below
        const tokenResponse = yield fetch("/session");
        const data = yield tokenResponse.json();
        const EPHEMERAL_KEY = data.client_secret.value;
        // Create a peer connection
        const pc = new RTCPeerConnection();
        // Set up to play remote audio from the model
        const audioEl = document.createElement("audio");
        audioEl.autoplay = true;
        pc.ontrack = e => audioEl.srcObject = e.streams[0];
        // Add local audio track for microphone input in the browser
        const ms = yield navigator.mediaDevices.getUserMedia({
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
            }
            else {
                icon.className = "fa-solid fa-microphone-slash";
                muteBtn.setAttribute("tooltip", "Unmute");
            }
        });
        // Set up data channel for sending and receiving events
        const dc = pc.createDataChannel("oai-events");
        dc.addEventListener("message", (e) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d;
            console.log(e);
            try {
                const data = JSON.parse(e.data);
                // Handle user transcript
                if (data.type === "conversation.item.input_audio_transcription.completed") {
                    addMessageToConversation("user", data.transcript);
                }
                // Handle assistant response
                if (data.type === "response.done" && ((_b = (_a = data.response) === null || _a === void 0 ? void 0 : _a.output) === null || _b === void 0 ? void 0 : _b.length)) {
                    const output = data.response.output[0];
                    if (output.type === "message" &&
                        output.role === "assistant" &&
                        ((_c = output.content) === null || _c === void 0 ? void 0 : _c.length)) {
                        // Find the transcript in the content array
                        const transcriptObj = output.content.find((c) => c.type === "audio" && c.transcript);
                        if (transcriptObj) {
                            addMessageToConversation("assistant", transcriptObj.transcript);
                        }
                    }
                    if (output.type === "function_call" &&
                        output.name === "web_search" &&
                        ((_d = output.arguments) === null || _d === void 0 ? void 0 : _d.length)) {
                        const args = JSON.parse(output.arguments);
                        const resp = yield fetch(`/web?q=${encodeURIComponent(args.question)}`);
                        const webResult = yield resp.json();
                        const reply = {
                            type: "conversation.item.create",
                            item: {
                                type: "function_call_output",
                                call_id: output.call_id,
                                output: JSON.stringify(webResult)
                            }
                        };
                        dc.send(JSON.stringify(reply));
                        dc.send(JSON.stringify({ type: "response.create" }));
                    }
                }
                if (data.type === "rate_limits.updated") {
                    const tokensLimit = data.rate_limits.find((rl) => rl.name === "tokens");
                    if (tokensLimit) {
                        const tokenText = document.getElementById("token-limit-text");
                        if (tokenText) {
                            tokenText.textContent = `Tokens Remaining: ${tokensLimit.remaining} / ${tokensLimit.limit}`;
                        }
                        const tokenBar = document.getElementById("token-limit-bar");
                        if (tokenBar) {
                            tokenBar.style.width = tokensLimit.remaining * 100 / tokensLimit.limit + "%";
                        }
                    }
                }
            }
            catch (err) {
                console.error("Failed to parse message:", e.data, err);
            }
        }));
        // Helper function to add a message to the conversation list
        function addMessageToConversation(role, text) {
            const list = document.getElementById("conversation-list");
            if (!list)
                return;
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
        const offer = yield pc.createOffer();
        yield pc.setLocalDescription(offer);
        const baseUrl = "https://api.openai.com/v1/realtime";
        const model = "gpt-4o-realtime-preview-2024-12-17";
        const sdpResponse = yield fetch(`${baseUrl}?model=${model}`, {
            method: "POST",
            body: offer.sdp,
            headers: {
                Authorization: `Bearer ${EPHEMERAL_KEY}`,
                "Content-Type": "application/sdp"
            },
        });
        const answer = {
            type: "answer",
            sdp: yield sdpResponse.text(),
        };
        yield pc.setRemoteDescription(answer);
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
                                question: { type: "string" }
                            },
                            required: ["question"]
                        }
                    }
                ]
            }
        };
        dc.addEventListener("open", () => {
            dc.send(JSON.stringify(sessionInit));
        });
    });
}
init();
