// The worker only needs to exist: the browser adapter reads the extension id from its URL.
self.addEventListener("install", () => self.skipWaiting());
