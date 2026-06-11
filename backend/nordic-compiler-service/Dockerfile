FROM node:24-bookworm-slim

ENV NCS_HOME=/opt/ncs
ENV ZEPHYR_BASE=/opt/ncs/zephyr
ENV ZEPHYR_TOOLCHAIN_VARIANT=zephyr
ENV ZEPHYR_SDK_INSTALL_DIR=/opt/zephyr-sdk-0.17.4
ENV PATH=/opt/ncs/.venv/bin:/opt/zephyr-sdk-0.17.4/arm-zephyr-eabi/bin:/usr/local/bin:/usr/bin:/bin

WORKDIR /service
COPY server.mjs .

EXPOSE 8772

ENTRYPOINT ["node", "server.mjs"]
