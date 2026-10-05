import { loadHikes, resolveHikeForDate } from './load-hikes.js';
import { hikeSlug } from '../src/lib/data/hikes-core.js';
import resume from '../src/lib/data/resume.json' with { type: "json" };
import { writeFile } from 'fs';

const hikes = loadHikes();

const rssFilePath = '../static/hikes/feed.xml';
const atomFilePath = '../static/hikes/atom.xml';
const now = new Date();

function writeOutput(filePath, content) {
	writeFile(filePath, content, err => {
		if (err) {
			console.error(err);
		} else {
			console.log('Wrote content to ' + filePath);
		}
	});
}

function escapeXml(unsafe) {
	return unsafe.replace(/[<>&'"]/g, function (c) {
		switch (c) {
			case '<': return '&lt;';
			case '>': return '&gt;';
			case '&': return '&amp;';
			case '\'': return '&apos;';
			case '"': return '&quot;';
		}
	});
}

let posts = hikes.flatMap(h => h.properties.dates
	.filter(d => !h.properties.draft && d.path)
	.map(d => {
		const date = new Date(d.date);
		date.setHours(16);
		const slug = hikeSlug(h.route);
		const hike = resolveHikeForDate(h, d);
		return {
			year: date.getFullYear(),
			month: date.getMonth() + 1,
			day: date.getDate(),
			date: date,
			url: `/${d.date}-${slug}/`,
			title: escapeXml(d.title ?? hike.name),
			image: (d.image ?? hike.image)?.replace('/hikes/', '/hikes/thumb/'),
			description: escapeXml((d.description ? (d.description + ' ') : '') + hike.description),
			tags: d.tags,
			people: d.people
		};
	}));
posts.sort((a, b) => a.date > b.date ? -1 : (a.date < b.date ? 1 : 0));
posts = posts.slice(0, 20); // Limit to latest 20 posts.

function generateRSS() {
	const header = `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>Hiking, Climbing, Via Ferrata &amp; Trail Maps | Personal Hike Experiences | Mykola Morozov</title>
  <link>https://mykolamor.com/hikes/</link>
  <description>The most thorough hike reviews on the web</description>
  <atom:link href="https://mykolamor.com/hikes/feed.xml" rel="self" type="application/rss+xml" />
  <language>en-us</language>
  <copyright>&amp;copy; ${now.getFullYear()} ${resume.basics.name}</copyright>
  <managingEditor>${resume.basics.email} (${resume.basics.name})</managingEditor>
	<webMaster>${resume.basics.email} (${resume.basics.name})</webMaster>
	<pubDate>${now.toUTCString()}</pubDate>
	<lastBuildDate>${now.toUTCString()}</lastBuildDate>
	<category>Sports</category>
	<docs>https://www.rssboard.org/rss-specification</docs>
	<ttl>1440</ttl>
	<image>
		<url>https://mykolamor.com/favicon.png</url>
		<title>Hiking, Climbing, Via Ferrata &amp; Trail Maps | Personal Hike Experiences</title>
		<link>https://mykolamor.com/hikes/</link>
	</image>
`;
	const footer = `
</channel>
</rss>`;

	const content = header + posts.map(post => `
  <item>
    <title>${post.title}</title>
    <link>https://mykolamor.com/hikes${post.url}</link>
    <description>${post.description}</description>
    <pubDate>${post.date.toUTCString()}</pubDate>
    <guid>https://mykolamor.com/hikes${post.url}</guid>
    <author>${resume.basics.email} (${resume.basics.name})</author>
  </item>`).join('') + footer;

	writeOutput(rssFilePath, content);
}

function generateAtom() {
	const header = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">

  <title>Hiking, Climbing, Via Ferrata &amp; Trail Maps | Personal Hike Experiences</title>
  <subtitle>The most thorough hike reviews on the web</subtitle>
  <link href="https://mykolamor.com/hikes/atom.xml" rel="self" />
  <link href="https://mykolamor.com/" />
  <id>https://mykolamor.com/hikes/</id>
  <updated>${now.toISOString()}</updated>
  <author>
    <name>${resume.basics.name}</name>
		<email>${resume.basics.email}</email>
		<uri>https://mykolamor.com/resume/</uri>
  </author>
  <category term="sports"/>
  <contributor>
		<name>${resume.basics.name}</name>
	</contributor>
	<icon>https://mykolamor.com/favicon.png</icon>
`;
	const footer = `
</feed>`;

	const content = header + posts.map(post => `
  <entry>
    <title>${post.title}</title>
    <link rel="alternate" href="https://mykolamor.com/hikes${post.url}" />
    <id>https://mykolamor.com/hikes${post.url}</id>
    <updated>${post.date.toISOString()}</updated>
    <published>${post.date.toISOString()}</published>
    <summary>${post.description}</summary>
    <rights type="html">
			&amp;copy; ${now.getFullYear()} ${resume.basics.name}
		</rights>
  </entry>`).join('') + footer;

	writeOutput(atomFilePath, content);
}

generateRSS();
generateAtom();
