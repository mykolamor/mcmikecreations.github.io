import { mount } from 'svelte';
import App from './App.svelte';
import './fill/drafts.css';
import { registerItemKind, registerTab } from './registry';
import ClaudeTab from './tabs/ClaudeTab.svelte';
import DetailsFiles from './tabs/DetailsFiles.svelte';
import FactsTab from './tabs/FactsTab.svelte';
import MapTab from './tabs/MapTab.svelte';
import PhotosTab from './tabs/PhotosTab.svelte';
import PlaceDetails from './tabs/PlaceDetails.svelte';
import PreviewTab from './tabs/PreviewTab.svelte';
import StringsTab from './tabs/StringsTab.svelte';
import WriteTab from './tabs/WriteTab.svelte';

registerItemKind({ id: 'hike', label: 'Hike' });
registerItemKind({ id: 'place', label: 'Place doc' });
// A language's label and tag table (`?strings=<lang>`): not a doc, one view.
registerItemKind({ id: 'strings', label: 'Label tables' });

registerTab({ id: 'details', label: 'Details & files', order: 10, component: DetailsFiles, kinds: ['hike'] });
registerTab({ id: 'map', label: 'Map', order: 20, component: MapTab, kinds: ['hike'] });
registerTab({ id: 'facts', label: 'Facts', order: 25, component: FactsTab, kinds: ['hike'] });
registerTab({ id: 'photos', label: 'Photos', order: 30, component: PhotosTab, kinds: ['hike', 'place'] });
// A place doc: its front matter only (no Files, Map).
registerTab({ id: 'details', label: 'Details', order: 10, component: PlaceDetails, kinds: ['place'] });
registerTab({ id: 'write', label: 'Write', order: 40, component: WriteTab, kinds: ['hike', 'place'] });
registerTab({ id: 'preview', label: 'Preview', order: 50, component: PreviewTab, kinds: ['hike', 'place'] });
registerTab({ id: 'strings', label: 'Label tables', order: 10, component: StringsTab, kinds: ['strings'] });
// Claude Code in the repo root: one session for the whole CRM, under every item.
registerTab({ id: 'claude', label: 'Claude', order: 90, component: ClaudeTab, kinds: ['hike', 'place', 'strings'] });

mount(App, { target: document.getElementById('app')! });
