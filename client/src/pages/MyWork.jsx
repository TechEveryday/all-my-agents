import TodoQueue from './TodoQueue.jsx';
import Streams from './Streams.jsx';
import { useApi } from '../api.js';

/** My Work tab. Stream data and the Agent Activity rail are owned by App so the rail survives tab switches. */
export default function MyWork({ tick, streams, railId, onOpenRail }) {
  const workflow = useApi('/workflow', [tick]);
  const list = streams.data?.streams || [];

  return (
    <div className="stack">
      <TodoQueue tick={tick} onClaimed={(created) => created?.[0] && onOpenRail(created[0].id)} />
      <Streams
        streams={list}
        steps={workflow.data?.steps || []}
        loading={streams.loading && !streams.data}
        error={streams.error}
        onOpen={(id) => onOpenRail(id === railId ? null : id)}
        onOpenActivity={onOpenRail}
        activeId={railId}
      />
    </div>
  );
}
