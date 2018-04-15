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
if (!config.simulation) {
	inkyphat = require("inkyphat").getInstance();
	displayInitPromise = inkyphat.init();
} else {
	displayInitPromise = Promise.resolve();
}

displayInitPromise.then(loadFont).then(() => {
	const mqttClient = mqtt.connect(config.mqttBroker);
	mqttClient.on("connect", function() {
		mqttClient.subscribe(config.mqttTopicTraffic);
	});

	mqttClient.on("message", function(topic, message) {
		switch (topic) {
		case config.mqttTopicTraffic:
			handleTrafficMessage(message); // async!
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


	if (config.simulation) {
		await writeImage(canvas);
	} else {
		const canvasPixels = ctx.getImageData(0, 0, displayDimX, displayDimY).data;

		let posY = 0;
		let posX = 0;
		for (let i = 0; i < canvasPixels.length; i+=4) {
			const r = canvasPixels[i];
			const g = canvasPixels[i + 1];
			const b = canvasPixels[i + 2];

			let color;
			if (r > 100 || g > 100 || b > 100) {
				color = inkyphat.BLACK;
			} else {
				color = inkyphat.WHITE;
			}
			inkyphat.setPixel(posX, posY, color);
			posX++;
			if (posX > displayDimX) {
				posX = 0;
				posY++;
				if (posY > displayDimY) {
					console.log(`Y-position out of bounds: ${posX}x${posY}`);
				}
			}
		}
		await inkyphat.redraw();
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
