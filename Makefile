DOCKERHUB_USER ?= shtrmx
VERSION ?= $(shell node -p "require('./game/package.json').version" 2>/dev/null || echo 0.2.5)
IMAGE := $(DOCKERHUB_USER)/fisle-game
DEV_PORT ?= 3001

.PHONY: build push run stop dev

build:
	docker build --build-arg VERSION=$(VERSION) -t $(IMAGE):$(VERSION) -t $(IMAGE):latest ./game

push: build
	docker push $(IMAGE):$(VERSION)
	docker push $(IMAGE):latest

run:
	docker compose up -d --build

stop:
	docker compose down

dev:
	PORT=$(DEV_PORT) npm --prefix game run dev
