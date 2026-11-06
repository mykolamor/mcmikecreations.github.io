// Demo-only language buttons for the presentation in the markdown test post. A plain script embed
// (see src/lib/renderers/ScriptEmbed.svelte): they call the frame's external API, not the toolbar.

const LANGS = [
	{ lang: 'en', label: 'EN', name: 'English' },
	{ lang: 'uk', label: 'UK', name: 'Українська' },
	{ lang: 'de', label: 'DE', name: 'Deutsch' }
];

export default function mount(container, { caption } = {}) {
	const group = document.createElement('div');
	group.setAttribute('role', 'group');
	group.setAttribute('aria-label', caption || 'Presentation language');
	group.style.cssText = 'display:flex;gap:0.5rem;flex-wrap:wrap;';
	for (const { lang, label, name } of LANGS) {
		const button = document.createElement('button');
		button.type = 'button';
		button.textContent = label;
		button.title = name;
		button.lang = lang;
		button.style.cssText = 'padding:0.25rem 0.9rem;border:1px solid currentColor;border-radius:0.375rem;font:inherit;cursor:pointer;background:transparent;color:inherit;';
		button.addEventListener('click', () => {
			document.querySelector('[data-presentation="demo"]')?.presentation?.setLanguage(lang);
		});
		group.append(button);
	}
	container.append(group);
	return () => group.remove();
}
