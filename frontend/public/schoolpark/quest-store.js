/* Existing sp_quests IDs remain stable. Numbers are allocated atomically;
   neither list order nor the number of documents is a sequence. */
(function (root) {
  const FOUNDER_ID = 'founder-quest-000';
  function label(q) {
    return Number.isSafeInteger(q.questNumber) && q.questNumber >= 0
      ? '#' + String(q.questNumber).padStart(3, '0') : '';
  }
  function isFounder(q) {
    return q.id === FOUNDER_ID && q.kind === 'founder' && q.questNumber === 0;
  }
  /* #000 の全文。記録の形が崩れていても、ここで必ず配列にして返す。
     素通しにすると、欄が1つ欠けただけで画面全体が描けなくなる。 */
  function sections(q) {
    if (!isFounder(q) || !Array.isArray(q.founderSections)) return [];
    return q.founderSections.map(function (s) {
      s = s || {};
      return { title: String(s.title || ''), body: String(s.body || '') };
    });
  }
  async function createQuest(fb, db, data) {
    const ref = fb.doc(fb.collection(db, 'sp_quests'));
    const counter = fb.doc(db, 'sp_quest_counters', 'quests');
    for (let attempt = 0; attempt < 12; attempt++) {
      let attemptedNumber = null;
      try { return await fb.runTransaction(db, async tx => {
      const snapshot = await tx.get(counter);
      // Safe rollout: until Rules + Founder are installed, preserve the old
      // issuing behavior. These records remain unnumbered historical Quests.
      if (!snapshot.exists()) {
        tx.set(ref, data);
        return { id: ref.id, questNumber: null };
      }
      const n = snapshot.data().nextNumber;
      attemptedNumber = n;
      if (!Number.isSafeInteger(n) || n < 1 || n >= 2147483647) {
        throw new Error('QUEST_SEQUENCE_INVALID');
      }
      const number = fb.doc(db, 'sp_quest_numbers', String(n));
      if ((await tx.get(number)).exists()) throw new Error('QUEST_NUMBER_CONFLICT');
      tx.set(ref, { ...data, questNumber: n });
      tx.set(number, { questId: ref.id });
      tx.update(counter, { nextNumber: n + 1, lastQuestId: ref.id });
      return { id: ref.id, questNumber: n };
      }); } catch (error) {
        // Concurrent commits can be rejected by Rules before the SDK reports
        // an aborted transaction. Retry only when the sequence actually moved.
        if (error.code !== 'permission-denied' || attemptedNumber === null) throw error;
        const latest = await fb.getDoc(counter);
        if (!latest.exists() || latest.data().nextNumber <= attemptedNumber) throw error;
      }
    }
    throw new Error('QUEST_SEQUENCE_BUSY');
  }
  const api = { FOUNDER_ID, label, isFounder, sections, createQuest };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SpQuestStore = api;
})(typeof window !== 'undefined' ? window : this);
