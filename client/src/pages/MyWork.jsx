import { useState } from 'react';
import TodoQueue from './TodoQueue.jsx';
import Streams from './Streams.jsx';
import AgentDrawer from './AgentDrawer.jsx';
import { useApi, useEvent } from '../api.js';

export default function MyWork({ tick }) {
  const streams = useApi('/streams', [tick]);
  const models = useApi('/models', [tick]);
  const workflow = useApi('/workflow', [tick]);
  const [openId, setOpenId] = useState(null);

  useEvent('stream', (s) =>
    streams.setData((d) => {
      if (!d) return d;
      const exists = d.streams.some((x) => x.id === s.id);
      return { streams: exists ? d.streams.map((x) => (x.id === s.id ? { ...x, ...s } : x)) : [s, ...d.streams] };
    }),
  );
  useEvent('stream-removed', ({ id }) => {
    streams.setData((d) => d && { streams: d.streams.filter((x) => x.id !== id) });
    if (openId === id) setOpenId(null);
  });

  const list = streams.data?.streams || [];
  const open = list.find((s) => s.id === openId);

  return (
    <div className="stack">
      <TodoQueue tick={tick} onClaimed={(created) => created?.[0] && setOpenId(created[0].id)} />
      <Streams streams={list} steps={workflow.data?.steps || []} loading={streams.loading && !streams.data} error={streams.error} onOpen={setOpenId} activeId={openId} />
      {open && <AgentDrawer stream={open} models={models.data?.models || []} onClose={() => setOpenId(null)} />}
    </div>
  );
}
