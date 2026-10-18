FROM wppconnect/wppconnect-server:2.10.42
# WA-JS 4.7.1 fixes MediaPrep bindings after WhatsApp Web split prepRawMedia.
ADD https://registry.npmjs.org/@wppconnect/wa-js/-/wa-js-4.7.1.tgz /tmp/wa-js.tgz
RUN echo 'a503ccff89af7b97fb18af292781af5183d4a0c1dc5d8d2eeb67c39b95ee4ce0  /tmp/wa-js.tgz' | sha256sum -c - \
    && tar -xzf /tmp/wa-js.tgz --strip-components=1 -C /usr/src/wpp-server/node_modules/@wppconnect/wa-js \
    && rm /tmp/wa-js.tgz
COPY deploy/wppconnect/start.sh /usr/local/bin/angibell-wppconnect-start
RUN chmod 755 /usr/local/bin/angibell-wppconnect-start
ENTRYPOINT ["/usr/local/bin/angibell-wppconnect-start"]
