FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb x11vnc fluxbox xterm python3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV DISPLAY=:1
WORKDIR /home/rakazo
CMD ["bash", "-lc", "Xvfb :1 -screen 0 1280x800x24 & sleep 0.5 && fluxbox & x11vnc -display :1 -forever -shared -nopw -listen 0.0.0.0 -rfbport 5900"]
