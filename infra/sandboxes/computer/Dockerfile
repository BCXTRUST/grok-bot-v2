FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    fluxbox \
    xterm \
    xdotool \
    x11-utils \
    novnc \
    websockify \
    python3 \
    ca-certificates \
    procps \
    bash \
  && rm -rf /var/lib/apt/lists/*
ENV DISPLAY=:1
ENV HOME=/home/rakazo
WORKDIR /home/rakazo
COPY start.sh /usr/local/bin/rakazo-computer
RUN chmod +x /usr/local/bin/rakazo-computer
EXPOSE 6080
CMD ["/usr/local/bin/rakazo-computer"]
