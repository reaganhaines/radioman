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
        pc.addTrack(ms.getTracks()[0]);
        // Set up data channel for sending and receiving events
        const dc = pc.createDataChannel("oai-events");
        dc.addEventListener("message", (e) => {
            // Realtime server events appear here!
            console.log(e);
        });
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
    });
}
init();
