// Pong as an ECS: components are Maps keyed by entity id, systems are functions
// over them. Embedded in the ECS blog post as `![caption](/images/blog/ecs/pong-sim.js)`;
// see src/lib/renderers/ScriptEmbed.svelte for the mount contract.

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgElement(name, attributes) {
	const element = document.createElementNS(SVG_NS, name);
	for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value));
	return element;
}

export default function mount(container, { caption } = {}) {
	// Scene. The border uses currentColor so it follows the text color in dark mode.
	const svg = svgElement('svg', { viewBox: '0 0 512 256', class: 'w-full', role: 'img' });
	svg.setAttribute('aria-label', caption || 'Animated Pong game: a racket follows a bouncing ball.');
	svg.append(
		svgElement('rect', { width: 512, height: 256, fill: 'transparent', stroke: 'currentColor', 'stroke-dasharray': '5 5', 'stroke-width': 5 })
	);
	const ball = svgElement('circle', { r: 5, fill: '#B00000', cx: 25, cy: 25 });
	const racket = svgElement('rect', { width: 10, height: 50, x: 5, rx: 5, ry: 5, fill: 'red' });
	svg.append(ball, racket, svgElement('rect', { width: 10, height: 256, x: 507, fill: 'red' }));
	container.append(svg);

	const deltaTime = 1.0 / 60.0;
	// Create components
	const position = new Map();
	const velocity = new Map();
	const isBall = new Map();
	const isRacket = new Map();
	// Seed component instances
	isRacket.set(0, []);
	isBall.set(1, []);
	position.set(0, [5.0, 0.0]);
	position.set(1, [25.0, 25.0]);
	velocity.set(1, [400.0, 260.0]);
	// Create systems
	const updatePosition = (deltaTime) => {
		velocity.forEach((value, key) => { // FROM Velocity
			if (position.has(key)) { // WHERE id=id
				const pos = position.get(key);
				position.set(key, [pos[0] + value[0] * deltaTime, pos[1] + value[1] * deltaTime]);
			}
		});
		position.forEach((value, key) => {
			if (velocity.has(key)) {
				const vel = velocity.get(key);
				if (value[0] >= 502.0) {
					velocity.set(key, [-Math.abs(vel[0]), vel[1]]);
				}
				if (value[0] <= 20.0) {
					velocity.set(key, [Math.abs(vel[0]), vel[1]]);
				}
				if (value[1] >= 251.0) {
					velocity.set(key, [vel[0], -Math.abs(vel[1])]);
				}
				if (value[1] <= 5.0) {
					velocity.set(key, [vel[0], Math.abs(vel[1])]);
				}
			}
		});
	};
	const updateRacket = () => {
		let minY = 256.0;
		isBall.forEach((value, key) => {
			if (position.has(key)) {
				const pos = position.get(key);
				if (minY > pos[1]) {
					minY = pos[1];
				}
			}
		});
		isRacket.forEach((value, key) => {
			if (position.has(key)) {
				position.set(key, [position.get(key)[0], Math.min(Math.max(minY - 25, 0.0), 206.0)]);
			}
		});
	};
	function update(deltaTime) {
		updatePosition(deltaTime);
		updateRacket();
		const ballId = isBall.keys().next().value;
		const racketId = isRacket.keys().next().value;
		ball.setAttribute('cx', position.has(ballId) ? position.get(ballId)[0].toString() : '0');
		ball.setAttribute('cy', position.has(ballId) ? position.get(ballId)[1].toString() : '0');
		racket.setAttribute('x', position.has(racketId) ? position.get(racketId)[0].toString() : '0');
		racket.setAttribute('y', position.has(racketId) ? position.get(racketId)[1].toString() : '0');
	}
	const intervalId = setInterval(update, 1000.0 * deltaTime, deltaTime);

	// Stop the simulation when the reader navigates away.
	return () => clearInterval(intervalId);
}
