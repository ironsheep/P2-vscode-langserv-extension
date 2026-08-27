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
# No apt packages are installed: the base image already provides unzip/curl, and
# image-tools-mcp is self-contained (Tesseract/Leptonica retired 2026-06-05).
FROM mcr.microsoft.com/devcontainers/javascript-node:22-bookworm

# --- pnut-ts compiler --------------------------------------------------------
# *** THE VERSION IS DISCOVERED, NOT TYPED. ***
# It used to be spelled out in three places -- the COPY, the cp path and the rm --
# so dropping a newer zip in and rebuilding silently rebuilt the OLD compiler,
# with nothing anywhere reporting which one you got. The glob takes every zip
# present and the sort picks the highest version, so adding a zip is the whole
# upgrade. The chosen version is echoed into the build log, and `pnut-ts
# --version` is run as a build-time smoke test so a bad binary fails the layer
# rather than the first compile that needs it.
#
# NOTE: the zip baked here is linux-arm64 (Apple Silicon host). Re-point the
# COPY glob if building on an x64 host.
COPY pnut-ts-linux-arm64-*.zip /tmp/pnut/
RUN cd /tmp/pnut \
    && ZIP="$(ls pnut-ts-linux-arm64-*.zip | sort -V | tail -1)" \
    && echo "Baking pnut-ts from ${ZIP}" \
    && unzip -oq "$ZIP" \
    && cp "${ZIP%.zip}/pnut_ts/pnut-ts" /usr/local/bin/pnut-ts \
    && chmod +x /usr/local/bin/pnut-ts \
    && mkdir -p /opt/pnut-ts-docs \
    && find "${ZIP%.zip}/pnut_ts" -maxdepth 1 -type f \
         ! -name 'pnut-ts' ! -name 'pnut_ts' -exec cp {} /opt/pnut-ts-docs/ \; \
    && cd / && rm -rf /tmp/pnut \
    && pnut-ts --version

# --- vsce, for packaging the .vsix (was: sudo npm i -g in postCreate) --------
RUN npm install -g @vscode/vsce

# --- Claude CLI (was: curl | bash in postCreateCommand) ----------------------
# Installed as the `node` user so it lands in /home/node/.local/bin.
USER node
RUN curl -fsSL https://claude.ai/install.sh | bash \
    && grep -q '\.local/bin' ~/.bashrc 2>/dev/null \
       || echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc

# --- shell environment: aliases (incl. myclaude), vi mode, dircolors --------
# Baked into the image so it survives a rebuild. Deliberately NOT `cat`-ed from
# /workspaces/<project> in postCreateCommand like most of the fleet does: this
# container mounts the REPO ROOT rather than spin2/, so a workspace-path-coupled
# copy breaks here -- which is exactly how the alias went missing after the
# 2026-07-18 compose migration. The file lives in .devcontainer/ because that is
# the only directory inside this image's build context.
COPY --chown=node:node bashrc /tmp/project-bashrc
RUN cat /tmp/project-bashrc >> /home/node/.bashrc \
    && rm /tmp/project-bashrc
USER root
