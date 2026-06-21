# 使用 Node.js LTS 作为基础镜像
FROM node:24-slim

# 设置环境变量
ENV PNPM_HOME="/pnpm"
ENV OPENCODE_PATH="/root/.opencode/bin"
ENV PATH="$PNPM_HOME:$OPENCODE_PATH:$PATH"
# 指定 pnpm 离线 store 的存储位置
ENV PNPM_CONFIG_STORE_DIR="/pnpm/store"

# 安装必要的系统依赖 (curl, git, sudo 等)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    git \
    openssh-client \
    sudo \
    tar \
    bzip2 \
    && rm -rf /var/lib/apt/lists/*

# 1. 使用 Corepack 安装并启用 pnpm
RUN corepack enable && corepack prepare pnpm@11.8.0 --activate

# 2. 安装 OpenCode (使用 pnpm 全局安装，包会放置在 $PNPM_HOME/bin 中)
RUN npm install -g opencode-ai@1.17.8

# 设置工作目录为仓库代码挂载点
WORKDIR /workspace

# 启动时默认运行 opencode
# 默认使用 pnpm install 准备依赖
CMD ["/bin/bash", "-c", "pnpm install && opencode"]