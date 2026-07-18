# Derived dev image for the Spin2 Language Server extension.
#
# Bakes the network-heavy installs that previously ran in postCreateCommand on
# EVERY container create (pnut-ts compiler + Claude CLI + vsce) into cached
# layers, so rebuilds are cheap and offline.
#
# EARNED DIVERGENCE (DEVCONTAINER-STANDARD.md Rule 0): the fleet standard base
# is javascript-node:24-bookworm, but this project pins @types/node ^22 and
# builds a VS Code extension against engines.vscode ^1.96.0. Staying on node 22
# keeps the build/test toolchain on its intended runtime. Revisit when the
# extension's @types/node moves to 24.
#
# NOTE: pnut-ts binary baked here is linux-arm64 (Apple Silicon host). Re-point
# the COPY/zip name if building on an x64 host.
#
# No apt packages are installed: the base image already provides unzip/curl, and
# image-tools-mcp is self-contained (Tesseract/Leptonica retired 2026-06-05).
FROM mcr.microsoft.com/devcontainers/javascript-node:22-bookworm

# --- pnut-ts compiler (was: unzip + cp in postCreateCommand) -----------------
COPY pnut-ts-linux-arm64-015500.zip /tmp/pnut-ts.zip
RUN cd /tmp \
    && unzip -o pnut-ts.zip \
    && cp /tmp/pnut-ts-linux-arm64-015500/pnut_ts/pnut-ts /usr/local/bin/pnut-ts \
    && chmod +x /usr/local/bin/pnut-ts \
    && rm -rf /tmp/pnut-ts.zip /tmp/pnut-ts-linux-arm64-015500

# --- vsce, for packaging the .vsix (was: sudo npm i -g in postCreate) --------
RUN npm install -g @vscode/vsce

# --- Claude CLI (was: curl | bash in postCreateCommand) ----------------------
# Installed as the `node` user so it lands in /home/node/.local/bin.
USER node
RUN curl -fsSL https://claude.ai/install.sh | bash \
    && grep -q '\.local/bin' ~/.bashrc 2>/dev/null \
       || echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
USER root
