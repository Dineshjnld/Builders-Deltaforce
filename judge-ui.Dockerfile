FROM node:26.12.1-trixie-slim
WORKDIR /app
RUN --mount=type=secret,id=judge_ca if [ -f /run/secrets/judge_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/judge_ca; fi; npm install -g corepack@0.35.0 && corepack enable
COPY . .
ENV DELTA_RUNTIME_URL=http://127.0.0.1:45224 NEXT_TELEMETRY_DISABLED=1 DELTA_BUILD_CPUS=2
RUN --mount=type=secret,id=judge_ca if [ -f /run/secrets/judge_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/judge_ca; fi; yarn install --immutable && yarn build:app
CMD ["yarn","workspace","@cognizant-ai-lab/neuro-san-web","start"]
