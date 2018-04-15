const {registerFont, createCanvas} = require("canvas");
const mqtt = require("mqtt");

const config = require("./config.json");

if (!config) {
	throw new Error("Missing configuration");
}

// const RED = "rgba(255,0,0,1)";
const BLACK = "rgba(0,0,0,1)";
const WHITE = "rgba(255,255,255,1)";

const displayDimX = 212;
const displayDimY = 104;

let displayInitPromise;
let inkyphat;
let busy = false;
if (!config.simulation) {
	inkyphat = require("inkyphat").getInstance();
	displayInitPromise = inkyphat.init();
} else {
	inkyphat = {
		pixels: [],
		setPixel: function(x, y, color) {
			this.pixels.push({
				x,
				y,
				fillStyle: color === 1 ? BLACK : WHITE
			});
		},
		redraw: async function() {},
		WHITE: 0,
		BLACK: 1,
		RED: 2
	};
	displayInitPromise = Promise.resolve();
}

displayInitPromise.then(loadFont).then(() => {
	const mqttClient = mqtt.connect(config.mqttBroker);
	mqttClient.on("connect", function() {
		mqttClient.subscribe(config.mqttTopicTraffic);
	});

	mqttClient.on("message", function(topic, message) {
		if (busy) {
			return;
		}
		switch (topic) {
		case config.mqttTopicTraffic:
			busy = true;
			handleTrafficMessage(message).then(() => {
				busy = false;
			}, (err) => {
				console.log("Error");
				console.log(err);
				busy = false;
			});
			break;
		default:
			console.log(`Received message for unknown topic '${topic}'`);
		}
	});
});

async function handleTrafficMessage(message) {
	const trafficData = JSON.parse(message);

	const canvas = createCanvas(displayDimX, displayDimY);
	const ctx = canvas.getContext("2d");
	ctx.fillStyle = WHITE;
	ctx.fillRect(0, 0, displayDimX, displayDimY);
	ctx.fillStyle = BLACK;

	ctx.font = "10px 'NotoSans'";
	console.log(trafficData);
	let nextTextPositionY = 20;
	for (let routeSummary in trafficData) {
		if (trafficData.hasOwnProperty(routeSummary)) {
			ctx.fillText(`${routeSummary}: ${trafficData[routeSummary].duration}min`, 10, nextTextPositionY);
			nextTextPositionY += 15;
		}
	}


	const canvasPixels = ctx.getImageData(0, 0, displayDimX, displayDimY).data;

	let posX = displayDimX;
	let posY = displayDimY;
	for (let i = 0; i < canvasPixels.length; i+=4) {
		const r = canvasPixels[i];
		const g = canvasPixels[i + 1];
		const b = canvasPixels[i + 2];

		let color;
		if (r > 100 || g > 100 || b > 100) {
			color = inkyphat.WHITE;
		} else {
			color = inkyphat.BLACK;
		}
		inkyphat.setPixel(posX, posY, color);
		posX--;
		if (posX < 0) {
			posX = displayDimX - 1;
			posY--;
			if (posY < 0 && i !== canvasPixels.length) {
				throw new Error(`Y-position out of bounds: ${posX}x${posY}`);
			}
		}
	}
	console.log("Drawing...");
	await inkyphat.redraw();

	if (config.simulation) {
		const simCanvas = createCanvas(displayDimX, displayDimY);
		const simCtx = simCanvas.getContext("2d");
		for (let j = 0; j < inkyphat.pixels.length; j++) {
			const {x, y, fillStyle} = inkyphat.pixels[j];
			simCtx.fillStyle = fillStyle;
			simCtx.fillRect(x, y, 1, 1);
		}
		await writeImage(simCanvas);
	}
}

function loadFont() {
	return new Promise((resolve, reject) => {
		registerFont("node_modules/notosans-fontface/fonts/NotoSans-Regular.ttf", {family: "NotoSans"});
		resolve();
	});
}

async function writeImage(display) {
	return new Promise((resolve, reject) => {
		const fs = require("fs");
		const out = fs.createWriteStream(__dirname + "/out.png");
		const stream = display.pngStream();

		stream.on("data", function(chunk) {
			out.write(chunk);
		});

		stream.on("end", function() {
			console.log("out.png written");
			resolve();
		});
	});
}
