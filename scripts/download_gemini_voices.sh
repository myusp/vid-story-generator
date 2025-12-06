#!/bin/bash

# Create directory
mkdir -p public/voices/gemini

# Base URL
BASE_URL="https://cloud.google.com/static/text-to-speech/docs/audio"

# List of voices
voices=(
    "chirp3-hd-achernar.wav"
    "chirp3-hd-achird.wav"
    "chirp3-hd-algenib.wav"
    "chirp3-hd-algieba.wav"
    "chirp3-hd-alnilam.wav"
    "chirp3-hd-aoeda.wav"
    "chirp3-hd-autonoe.wav"
    "chirp3-hd-callirrhoe.wav"
    "chirp3-hd-charon.wav"
    "chirp3-hd-despina.wav"
    "chirp3-hd-enceladus.wav"
    "chirp3-hd-erinome.wav"
    "chirp3-hd-fenrir.wav"
    "chirp3-hd-gacrux.wav"
    "chirp3-hd-iapetus.wav"
    "chirp3-hd-kore.wav"
    "chirp3-hd-laomedeia.wav"
    "chirp3-hd-leda.wav"
    "chirp3-hd-orus.wav"
    "chirp3-hd-pulcherrima.wav"
    "chirp3-hd-puck.wav"
    "chirp3-hd-rasalgethi.wav"
    "chirp3-hd-sadachbia.wav"
    "chirp3-hd-sadaltager.wav"
    "chirp3-hd-schedar.wav"
    "chirp3-hd-sulafat.wav"
    "chirp3-hd-umbriel.wav"
    "chirp3-hd-vindemiatrix.wav"
    "chirp3-hd-zephyr.wav"
    "chirp3-hd-zubenelgenubi.wav"
)

# Download each voice
for voice in "${voices[@]}"; do
    echo "Downloading $voice..."
    curl -L -s -o "public/voices/gemini/$voice" "$BASE_URL/$voice"
done

echo "Download complete!"
