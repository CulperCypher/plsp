FROM node:20-bullseye

WORKDIR /app
COPY package*.json ./
RUN npm install --production

SHELL ["/bin/bash", "-lc"]

RUN curl -L https://raw.githubusercontent.com/foundry-rs/starknet-foundry/master/scripts/install.sh | bash \
    && source /root/.bashrc \
    && snfoundryup \
    && ln -s /root/.local/bin/sncast /usr/local/bin/sncast

COPY .starknet_accounts /root/.starknet_accounts

COPY . .

CMD ["npm", "run", "start"]