import type {
  Card,
  Command,
  GameSession,
  MatchConfig,
  PlayerState,
  PublicEffect,
  RandomSource,
  RouletteSetup,
  Ruleset,
  TableRank,
  Transition,
  RoomEventPayloads,
} from './types';

function action(session: GameSession, kind: RoomEventPayloads['game:action']['kind'], payload: Omit<RoomEventPayloads['game:action'], 'actionId' | 'occurredAt' | 'kind'> = {}): PublicEffect {
  const sequence = ++session.state.actionSequence;
  return { event: 'game:action', payload: { actionId: `wager:${session.state.round}:${sequence}`, occurredAt: sequence, kind, ...payload } };
}

export type * from './types';

const MAX_PLAYERS = 4;

function randomIndex(length: number, random: RandomSource) {
  return Math.min(length - 1, Math.max(0, Math.floor(random() * length)));
}

function shuffle<T>(items: T[], random: RandomSource) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = randomIndex(index + 1, random);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function classicDeck(): Card[] {
  const ranks: TableRank[] = ['A', 'K', 'Q'];
  return [
    ...ranks.flatMap((kind) =>
      Array.from({ length: 6 }, (_, index) => ({
        id: `${kind}-${index + 1}`,
        kind,
        devilMarked: index === 0,
      })),
    ),
    { id: 'joker-1', kind: 'joker' },
    { id: 'joker-2', kind: 'joker' },
  ];
}

function chaosDeck(): Card[] {
  return [
    ...Array.from({ length: 5 }, (_, index) => ({ id: `K-${index + 1}`, kind: 'K' as const })),
    ...Array.from({ length: 5 }, (_, index) => ({ id: `Q-${index + 1}`, kind: 'Q' as const })),
    { id: 'master-1', kind: 'master' as const },
    { id: 'chaos-1', kind: 'chaos' as const },
  ];
}

function handSize(ruleset: Ruleset) {
  return ruleset === 'chaos' ? 3 : 5;
}

function createPlayer(player: MatchConfig['players'][number], seat: number): PlayerState {
  return {
    ...player,
    seat,
    ready: false,
    connected: true,
    alive: true,
    handCount: 0,
    safePulls: 0,
    wins: player.wins ?? 0,
  };
}

function dealRound(session: GameSession, random: RandomSource, starterId?: string) {
  const alive = livingPlayers(session);
  const deck = shuffle(session.state.ruleset === 'chaos' ? chaosDeck() : classicDeck(), random);
  const size = handSize(session.state.ruleset);
  for (const player of Object.values(session.state.players)) {
    const hand = player.alive ? deck.splice(0, size) : [];
    session.secret.hands[player.id] = hand;
    player.handCount = hand.length;
  }
  session.secret.deck = deck;
  const tableRanks: TableRank[] = session.state.ruleset === 'chaos' ? ['K', 'Q'] : ['A', 'K', 'Q'];
  const requestedStarter = starterId ? session.state.players[starterId] : null;
  let resolvedStarter = requestedStarter?.alive ? requestedStarter : null;
  if (!resolvedStarter && requestedStarter) {
    for (let offset = 1; offset <= MAX_PLAYERS; offset += 1) {
      const id = session.state.seats[(requestedStarter.seat + offset) % MAX_PLAYERS];
      if (id && session.state.players[id]?.alive) {
        resolvedStarter = session.state.players[id];
        break;
      }
    }
  }
  session.secret.pile = [];
  session.secret.shotTargets = {};
  session.state.phase = 'playing';
  session.state.round += 1;
  session.state.tableRank = tableRanks[randomIndex(tableRanks.length, random)];
  session.state.currentPlayerId = resolvedStarter?.id ?? alive[randomIndex(alive.length, random)]?.id ?? null;
  session.state.lastPlay = null;
  session.state.pileCount = 0;
  session.state.reveal = null;
  session.state.roulette = null;
  session.state.resolution = null;
  session.state.message = `第 ${session.state.round} 轮：${session.state.tableRank} 桌`;
}

export function createMatch(config: MatchConfig, random: RandomSource): GameSession {
  const inputs = config.players.slice(0, MAX_PLAYERS);
  const players = Object.fromEntries(inputs.map((player, seat) => [player.id, createPlayer(player, seat)]));
  const seats = Array<string | null>(MAX_PLAYERS).fill(null);
  inputs.forEach((player, seat) => {
    seats[seat] = player.id;
  });

  const session: GameSession = {
    state: {
      version: 1,
      actionSequence: 0,
      phase: 'lobby',
      ruleset: config.ruleset,
      hostId: config.hostId,
      players,
      seats,
      round: 0,
      tableRank: null,
      currentPlayerId: null,
      lastPlay: null,
      pileCount: 0,
      reveal: null,
      roulette: null,
      resolution: null,
      winnerId: null,
      draw: false,
      message: '等待玩家准备',
    },
    secret: {
      hands: {},
      deck: [],
      pile: [],
      fatalPulls: {},
      shotTargets: {},
    },
  };

  if (config.start !== false && inputs.length >= 2) {
    for (const player of inputs) {
      session.secret.fatalPulls[player.id] = randomIndex(6, random) + 1;
    }
    dealRound(session, random);
  }

  return session;
}

function cloneSession(session: GameSession): GameSession {
  return JSON.parse(JSON.stringify(session)) as GameSession;
}

function transition(session: GameSession): Transition {
  return { session, sends: [], broadcasts: [], schedules: [] };
}

function invalid(session: GameSession, actorId: string, message: string): Transition {
  return {
    ...transition(session),
    error: message,
    sends: [{ playerId: actorId, event: 'game:invalid', payload: { message } }],
  };
}

function livingPlayers(session: GameSession) {
  return session.state.seats
    .map((id) => (id ? session.state.players[id] : null))
    .filter((player): player is PlayerState => Boolean(player?.alive));
}

function nextPlayerWithCards(session: GameSession, actorId: string) {
  const actor = session.state.players[actorId];
  if (!actor) return null;
  for (let offset = 1; offset <= MAX_PLAYERS; offset += 1) {
    const seat = (actor.seat + offset) % MAX_PLAYERS;
    const id = session.state.seats[seat];
    if (id && session.state.players[id]?.alive && session.state.players[id].handCount > 0) return id;
  }
  return null;
}

function playCards(session: GameSession, command: Extract<Command, { type: 'playCards' }>): Transition {
  if (session.state.phase !== 'playing') return invalid(session, command.actorId, '现在不能出牌');
  if (session.state.currentPlayerId !== command.actorId) return invalid(session, command.actorId, '还没轮到你');
  const holders = livingPlayers(session).filter((player) => player.handCount > 0);
  if (session.secret.pile.length > 0 && holders.length === 1 && holders[0].id === command.actorId) {
    return invalid(session, command.actorId, '只剩你持牌，必须质疑上一手');
  }
  const uniqueIds = [...new Set(command.cardIds)];
  const limit = session.state.ruleset === 'chaos' ? 1 : 3;
  const minimum = session.state.ruleset === 'chaos' ? 1 : 1;
  if (uniqueIds.length < minimum || uniqueIds.length > limit || uniqueIds.length !== command.cardIds.length) {
    return invalid(session, command.actorId, session.state.ruleset === 'chaos' ? '混沌局每次只能出一张牌' : '请选择一至三张牌');
  }

  const hand = session.secret.hands[command.actorId] ?? [];
  if (uniqueIds.some((id) => !hand.some((card) => card.id === id))) {
    return invalid(session, command.actorId, '你没有这些牌');
  }
  const selectedFromCurrent = hand.filter((card) => uniqueIds.includes(card.id));
  if (selectedFromCurrent.some((card) => isActiveDevil(session, card)) && selectedFromCurrent.length !== 1) {
    return invalid(session, command.actorId, '恶魔牌必须单独打出');
  }

  const next = cloneSession(session);
  const selected = next.secret.hands[command.actorId].filter((card) => uniqueIds.includes(card.id));
  next.secret.hands[command.actorId] = next.secret.hands[command.actorId].filter((card) => !uniqueIds.includes(card.id));
  next.secret.pile.push({ playerId: command.actorId, cards: selected });
  next.state.players[command.actorId].handCount = next.secret.hands[command.actorId].length;
  next.state.lastPlay = { playerId: command.actorId, count: selected.length };
  next.state.pileCount += selected.length;
  next.state.currentPlayerId = nextPlayerWithCards(next, command.actorId);
  next.state.message = `${next.state.players[command.actorId].name} 扣下了 ${selected.length} 张牌`;

  if (next.state.ruleset === 'chaos' && selected[0]?.kind === 'chaos') {
    const shooters = livingPlayers(next).map((player) => player.id);
    next.state.reveal = {
      reason: 'chaos',
      accusedId: command.actorId,
      callerId: null,
      cards: selected,
    };
    next.state.message = '混沌牌翻开——所有人选择一个目标';
    beginRoulette(next, {
      kind: 'simultaneous',
      shooters,
      fixedTargets: {},
      resume: 'continue',
      starterId: nextPlayerWithCards(next, command.actorId) ?? command.actorId,
    });
    return {
      ...transition(next),
      sends: [
        {
          playerId: command.actorId,
          event: 'private:hand',
          payload: { hand: next.secret.hands[command.actorId] },
        },
      ],
      broadcasts: [{ event: 'game:reveal', payload: next.state.reveal }, action(next, 'cardsCommitted', { actorId: command.actorId, count: selected.length, label: '混沌牌' }), action(next, 'reveal', { actorId: command.actorId, cards: selected, label: '混沌牌揭示' }), action(next, 'specialResolved', { actorId: command.actorId, cards: selected, label: '混沌' })],
    };
  }

  return {
    ...transition(next),
    sends: [
      {
        playerId: command.actorId,
        event: 'private:hand',
        payload: { hand: next.secret.hands[command.actorId] },
      },
    ],
    broadcasts: [
      {
        event: 'game:notice',
        payload: { message: next.state.message },
      },
      action(next, 'cardsCommitted', { actorId: command.actorId, count: selected.length, label: `暗出 ${selected.length} 张` }),
    ],
  };
}

function isActiveDevil(session: GameSession, card: Card) {
  return (
    session.state.ruleset === 'devil' &&
    livingPlayers(session).length >= 3 &&
    card.devilMarked === true &&
    card.kind === session.state.tableRank
  );
}

function isInnocent(session: GameSession, card: Card) {
  if (card.kind === 'joker' || card.kind === 'master' || card.kind === 'chaos') return true;
  return card.kind === session.state.tableRank && !isActiveDevil(session, card);
}

function beginRoulette(
  session: GameSession,
  options: RouletteSetup,
) {
  session.state.phase = 'roulette';
  session.state.roulette = {
    kind: options.kind,
    shooterIds: options.shooters,
    fixedTargets: options.fixedTargets,
    committed: [],
    resume: options.resume,
    starterId: options.starterId,
  };
}

function callLiar(session: GameSession, command: Extract<Command, { type: 'callLiar' }>): Transition {
  if (session.state.phase !== 'playing') return invalid(session, command.actorId, '现在不能质疑');
  if (session.state.currentPlayerId !== command.actorId) return invalid(session, command.actorId, '还没轮到你');
  const lastPlay = session.secret.pile.at(-1);
  if (!lastPlay) return invalid(session, command.actorId, '还没有可以质疑的牌');

  const next = cloneSession(session);
  const revealed = next.secret.pile.at(-1)!;
  const activeDevil = revealed.cards.some((card) => isActiveDevil(next, card));
  if (activeDevil) {
    const shooters = livingPlayers(next)
      .filter((player) => player.id !== revealed.playerId && player.handCount > 0)
      .map((player) => player.id);
    next.state.reveal = {
      reason: 'devil',
      accusedId: revealed.playerId,
      callerId: command.actorId,
      cards: revealed.cards,
    };
    next.state.message = '恶魔翻开了所有人的枪套';
    beginRoulette(next, {
      kind: 'simultaneous',
      shooters,
      fixedTargets: Object.fromEntries(shooters.map((id) => [id, id])),
      resume: 'redeal',
      starterId: command.actorId,
    });
    return {
      ...transition(next),
      broadcasts: [{ event: 'game:reveal', payload: next.state.reveal }, action(next, 'reveal', { actorId: command.actorId, targetIds: [revealed.playerId], cards: revealed.cards, label: '恶魔牌揭示' }), action(next, 'specialResolved', { actorId: revealed.playerId, cards: revealed.cards, label: '恶魔' })],
    };
  }

  if (next.state.ruleset === 'chaos') {
    const card = revealed.cards[0];
    const starterId = nextPlayerWithCards(next, revealed.playerId) ?? command.actorId;
    if (card.kind === 'master') {
      next.state.reveal = {
        reason: 'master',
        accusedId: revealed.playerId,
        callerId: command.actorId,
        cards: revealed.cards,
      };
      next.state.message = `${next.state.players[revealed.playerId].name} 翻开了主宰牌`;
      beginRoulette(next, {
        kind: 'targeted',
        shooters: [revealed.playerId],
        fixedTargets: {},
        resume: 'continue',
        starterId,
      });
      return {
        ...transition(next),
        broadcasts: [{ event: 'game:reveal', payload: next.state.reveal }, action(next, 'reveal', { actorId: command.actorId, targetIds: [revealed.playerId], cards: revealed.cards, label: '主宰牌揭示' }), action(next, 'specialResolved', { actorId: revealed.playerId, cards: revealed.cards, label: '主宰' })],
      };
    }

    const hasChaosLie = !isInnocent(next, card);
    const fixedTargets = hasChaosLie ? { [command.actorId]: revealed.playerId } : { [command.actorId]: command.actorId };
    next.state.reveal = {
      reason: 'liar',
      accusedId: revealed.playerId,
      callerId: command.actorId,
      cards: revealed.cards,
    };
    next.state.message = hasChaosLie
      ? `${next.state.players[command.actorId].name} 抓住了谎言`
      : `${next.state.players[command.actorId].name} 质疑失败`;
    beginRoulette(next, {
      kind: hasChaosLie ? 'targeted' : 'self',
      shooters: [command.actorId],
      fixedTargets,
      resume: hasChaosLie ? 'continue' : 'redeal',
      starterId: hasChaosLie ? starterId : command.actorId,
    });
    return {
      ...transition(next),
      broadcasts: [{ event: 'game:reveal', payload: next.state.reveal }, action(next, 'reveal', { actorId: command.actorId, targetIds: [revealed.playerId], cards: revealed.cards, label: hasChaosLie ? '谎言被识破' : '质疑失败' })],
    };
  }
  const hasLie = revealed.cards.some((card) => !isInnocent(next, card));
  const loserId = hasLie ? revealed.playerId : command.actorId;
  next.state.reveal = {
    reason: 'liar',
    accusedId: revealed.playerId,
    callerId: command.actorId,
    cards: revealed.cards,
  };
  next.state.message = hasLie
    ? `${next.state.players[revealed.playerId].name} 被识破了`
    : `${next.state.players[command.actorId].name} 误判了`;
  beginRoulette(next, {
    kind: 'self',
    shooters: [loserId],
    fixedTargets: { [loserId]: loserId },
    resume: 'redeal',
    starterId: loserId,
  });
  return {
    ...transition(next),
    broadcasts: [{ event: 'game:reveal', payload: next.state.reveal }, action(next, 'reveal', { actorId: command.actorId, targetIds: [revealed.playerId], cards: revealed.cards, label: hasLie ? '谎言被识破' : '质疑失败' })],
  };
}

function callDevilsDeal(
  session: GameSession,
  command: Extract<Command, { type: 'callDevilsDeal' }>,
): Transition {
  if (session.state.ruleset !== 'devil') return invalid(session, command.actorId, '只有恶魔局可以发动恶魔交易');
  if (session.state.phase !== 'playing') return invalid(session, command.actorId, '现在不能发动恶魔交易');
  if (session.state.currentPlayerId !== command.actorId) return invalid(session, command.actorId, '还没轮到你');
  const cards = session.secret.pile.flatMap((play) => play.cards).slice(-4);
  if (cards.length < 4) return invalid(session, command.actorId, '桌上还没有四张牌');

  const next = cloneSession(session);
  const revealed = next.secret.pile.flatMap((play) => play.cards).slice(-4);
  const allLies = revealed.every((card) => !isInnocent(next, card) && !isActiveDevil(next, card));
  const shooters = allLies
    ? livingPlayers(next).filter((player) => player.id !== command.actorId).map((player) => player.id)
    : [command.actorId];
  next.state.reveal = {
    reason: 'devils-deal',
    accusedId: null,
    callerId: command.actorId,
    cards: revealed,
  };
  next.state.message = allLies ? '四张谎言——恶魔收取全桌赌债' : '交易失败，恶魔只盯上了发动者';
  beginRoulette(next, {
    kind: shooters.length === 1 ? 'self' : 'simultaneous',
    shooters,
    fixedTargets: Object.fromEntries(shooters.map((id) => [id, id])),
    resume: 'redeal',
    starterId: command.actorId,
  });
  return {
    ...transition(next),
    broadcasts: [{ event: 'game:reveal', payload: next.state.reveal }, action(next, 'reveal', { actorId: command.actorId, cards: revealed, label: allLies ? '四张谎言' : '恶魔交易失败' }), action(next, 'specialResolved', { actorId: command.actorId, cards: revealed, label: '恶魔交易' })],
  };
}

function finishShots(session: GameSession, random: RandomSource): Transition {
  const roulette = session.state.roulette!;
  const results = roulette.shooterIds.map((shooterId) => {
    const shooter = session.state.players[shooterId];
    const targetId = session.secret.shotTargets[shooterId];
    const lethal = shooter.safePulls + 1 >= session.secret.fatalPulls[shooterId];
    return { shooterId, targetId, lethal };
  });

  for (const result of results) {
    const shooter = session.state.players[result.shooterId];
    if (result.lethal) {
      session.state.players[result.targetId].alive = false;
      session.state.players[result.targetId].handCount = 0;
      session.secret.hands[result.targetId] = [];
    }
    else shooter.safePulls += 1;
  }
  for (const result of results) {
    if (
      result.lethal &&
      result.shooterId !== result.targetId &&
      session.state.players[result.shooterId].alive
    ) {
      session.state.players[result.shooterId].safePulls = 0;
      session.secret.fatalPulls[result.shooterId] = randomIndex(6, random) + 1;
    }
  }

  const alive = livingPlayers(session);
  session.state.roulette = null;
  if (alive.length <= 1) {
    session.state.phase = 'finished';
    session.state.draw = alive.length === 0;
    session.state.winnerId = alive[0]?.id ?? null;
    session.state.currentPlayerId = null;
    session.state.resolution = { shots: results, resume: roulette.resume, starterId: roulette.starterId };
    session.state.message = alive[0] ? `${alive[0].name} 活到了最后` : '无人走出午夜赌局';
    if (alive[0]) alive[0].wins += 1;
    return {
      ...transition(session),
      broadcasts: [{ event: 'game:shots', payload: { shots: results, finished: true } }, action(session, 'shots', { actorId: results[0]?.shooterId, targetIds: results.map((shot) => shot.targetId), shots: results, label: results.some((shot) => shot.lethal) ? '枪响' : '空枪' }), action(session, 'roundSettled', { actorId: alive[0]?.id, label: alive[0] ? `${alive[0].name} 活到了最后` : '无人幸存' })],
    };
  }

  session.state.phase = 'resolution';
  session.state.resolution = { shots: results, resume: roulette.resume, starterId: roulette.starterId };
  session.state.message = results.some((shot) => shot.lethal) ? '枪声撕开了酒馆' : '只有一声空响';
  return {
    ...transition(session),
    broadcasts: [{ event: 'game:shots', payload: { shots: results, finished: false } }, action(session, 'shots', { actorId: results[0]?.shooterId, targetIds: results.map((shot) => shot.targetId), shots: results, label: results.some((shot) => shot.lethal) ? '枪响' : '空枪' })],
    schedules: [
      {
        name: 'resolution',
        ms: 1800,
        command: { type: 'advanceResolution', actorId: session.state.hostId },
      },
    ],
  };
}

function pullTrigger(
  session: GameSession,
  command: Extract<Command, { type: 'pullTrigger' }>,
  random: RandomSource,
): Transition {
  const roulette = session.state.roulette;
  if (session.state.phase !== 'roulette' || !roulette) return invalid(session, command.actorId, '现在不能扣动扳机');
  if (!roulette.shooterIds.includes(command.actorId)) return invalid(session, command.actorId, '这一次不由你开枪');
  if (roulette.committed.includes(command.actorId)) return invalid(session, command.actorId, '你已经扣动过扳机');

  const next = cloneSession(session);
  const nextRoulette = next.state.roulette!;
  const fixedTarget = nextRoulette.fixedTargets[command.actorId];
  const targetId = fixedTarget ?? command.targetId;
  const target = targetId ? next.state.players[targetId] : null;
  if (!target || !target.alive || (!fixedTarget && targetId === command.actorId)) {
    return invalid(session, command.actorId, '请选择一名仍然活着的对手');
  }
  next.secret.shotTargets[command.actorId] = targetId;
  nextRoulette.committed.push(command.actorId);
  if (nextRoulette.committed.length < nextRoulette.shooterIds.length) return transition(next);
  return finishShots(next, random);
}

function advanceResolution(session: GameSession, random: RandomSource): Transition {
  if (session.state.phase !== 'resolution' || !session.state.resolution) {
    return invalid(session, session.state.hostId, '没有待结算的牌局');
  }
  const next = cloneSession(session);
  const resolution = next.state.resolution!;
  if (resolution.resume === 'continue') {
    next.secret.pile = [];
    next.secret.shotTargets = {};
    next.state.lastPlay = null;
    next.state.pileCount = 0;
    next.state.reveal = null;
    next.state.roulette = null;
    next.state.resolution = null;
    const holders = livingPlayers(next).filter((player) => player.handCount > 0);
    if (holders.length >= 2) {
      const requested = next.state.players[resolution.starterId];
      next.state.phase = 'playing';
      next.state.currentPlayerId = requested?.alive && requested.handCount > 0
        ? requested.id
        : nextPlayerWithCards(next, resolution.starterId);
      next.state.message = '混沌仍在继续';
      return transition(next);
    }
  }
  dealRound(next, random, resolution.starterId);
  return {
    ...transition(next),
    sends: livingPlayers(next).map((player) => ({
      playerId: player.id,
      event: 'private:hand',
      payload: { hand: next.secret.hands[player.id] },
    })),
    broadcasts: [{ event: 'game:round', payload: { round: next.state.round, tableRank: next.state.tableRank } }],
  };
}

function playerJoined(session: GameSession, command: Extract<Command, { type: 'playerJoined' }>): Transition {
  if (session.state.phase !== 'lobby') return invalid(session, command.actorId, '牌局进行中，暂时不能入座');
  if (session.state.players[command.player.id]) {
    return playerReconnected(session, {
      type: 'playerReconnected',
      actorId: command.player.id,
      name: command.player.name,
    });
  }
  const seat = session.state.seats.findIndex((id) => id === null);
  if (seat < 0) return invalid(session, command.actorId, '牌桌已满');
  const next = cloneSession(session);
  if (!next.state.hostId) next.state.hostId = command.player.id;
  next.state.seats[seat] = command.player.id;
  next.state.players[command.player.id] = createPlayer(command.player, seat);
  next.state.message = Object.keys(next.state.players).length < 2 ? '等待至少两名玩家入座' : '选择规则并准备';
  return transition(next);
}

function playerLeft(session: GameSession, command: Extract<Command, { type: 'playerLeft' }>): Transition {
  const player = session.state.players[command.actorId];
  if (!player) return transition(session);
  const next = cloneSession(session);
  if (next.state.phase === 'lobby') {
    next.state.seats[player.seat] = null;
    delete next.state.players[command.actorId];
    delete next.secret.hands[command.actorId];
    next.state.message = '等待玩家入座';
  } else {
    next.state.players[command.actorId].connected = false;
    next.state.message = `${player.name} 已断线，牌局等待其重连`;
  }
  return transition(next);
}

function playerReconnected(
  session: GameSession,
  command: Extract<Command, { type: 'playerReconnected' }>,
): Transition {
  const player = session.state.players[command.actorId];
  if (!player) return invalid(session, command.actorId, '找不到保留席位');
  const next = cloneSession(session);
  next.state.players[command.actorId].connected = true;
  next.state.players[command.actorId].name = command.name;
  return {
    ...transition(next),
    sends: [
      {
        playerId: command.actorId,
        event: 'private:hand',
        payload: { hand: next.secret.hands[command.actorId] ?? [] },
      },
    ],
  };
}

function setRuleset(session: GameSession, command: Extract<Command, { type: 'setRuleset' }>): Transition {
  if (session.state.phase !== 'lobby') return invalid(session, command.actorId, '牌局开始后不能切换规则');
  if (command.actorId !== session.state.hostId) return invalid(session, command.actorId, '只有房主可以切换规则');
  const next = cloneSession(session);
  next.state.ruleset = command.ruleset;
  for (const player of Object.values(next.state.players)) player.ready = false;
  next.state.message = '规则已切换，请重新准备';
  return transition(next);
}

function setReady(
  session: GameSession,
  command: Extract<Command, { type: 'setReady' }>,
  random: RandomSource,
): Transition {
  if (session.state.phase !== 'lobby') return invalid(session, command.actorId, '牌局已经开始');
  if (!session.state.players[command.actorId]) return invalid(session, command.actorId, '你还没有入座');
  const next = cloneSession(session);
  next.state.players[command.actorId].ready = command.ready;
  const seated = next.state.seats
    .map((id) => (id ? next.state.players[id] : null))
    .filter((player): player is PlayerState => Boolean(player));
  if (seated.length < 2 || seated.some((player) => !player.ready)) {
    next.state.message = seated.length < 2 ? '等待至少两名玩家入座' : '等待所有玩家准备';
    return transition(next);
  }

  for (const player of seated) {
    player.alive = true;
    player.safePulls = 0;
    player.ready = false;
    next.secret.fatalPulls[player.id] = randomIndex(6, random) + 1;
  }
  next.state.winnerId = null;
  next.state.draw = false;
  next.state.round = 0;
  dealRound(next, random);
  return {
    ...transition(next),
    sends: seated.map((player) => ({
      playerId: player.id,
      event: 'private:hand',
      payload: { hand: next.secret.hands[player.id] },
    })),
    broadcasts: [{ event: 'game:start', payload: { ruleset: next.state.ruleset } }],
  };
}

function syncPrivate(session: GameSession, command: Extract<Command, { type: 'syncPrivate' }>): Transition {
  if (!session.state.players[command.actorId]) return invalid(session, command.actorId, '你还没有入座');
  return {
    ...transition(session),
    sends: [
      {
        playerId: command.actorId,
        event: 'private:hand',
        payload: { hand: session.secret.hands[command.actorId] ?? [] },
      },
    ],
  };
}

function abortMatch(session: GameSession, command: Extract<Command, { type: 'abortMatch' }>): Transition {
  if (command.actorId !== session.state.hostId) return invalid(session, command.actorId, '只有房主可以中止牌局');
  const next = cloneSession(session);
  for (const player of Object.values(next.state.players)) {
    player.ready = false;
    player.alive = true;
    player.handCount = 0;
    player.safePulls = 0;
  }
  next.state.phase = 'lobby';
  next.state.round = 0;
  next.state.tableRank = null;
  next.state.currentPlayerId = null;
  next.state.lastPlay = null;
  next.state.pileCount = 0;
  next.state.reveal = null;
  next.state.roulette = null;
  next.state.resolution = null;
  next.state.winnerId = null;
  next.state.draw = false;
  next.state.message = '牌局已中止，请重新准备';
  next.secret = { hands: {}, deck: [], pile: [], fatalPulls: {}, shotTargets: {} };
  return {
    ...transition(next),
    broadcasts: [{ event: 'game:aborted', payload: {} }],
  };
}

export function applyCommand(session: GameSession, command: Command, random: RandomSource): Transition {
  if (command.type === 'playerJoined') return playerJoined(session, command);
  if (command.type === 'playerLeft') return playerLeft(session, command);
  if (command.type === 'playerReconnected') return playerReconnected(session, command);
  if (command.type === 'setRuleset') return setRuleset(session, command);
  if (command.type === 'setReady') return setReady(session, command, random);
  if (command.type === 'playCards') return playCards(session, command);
  if (command.type === 'callLiar') return callLiar(session, command);
  if (command.type === 'callDevilsDeal') return callDevilsDeal(session, command);
  if (command.type === 'pullTrigger') return pullTrigger(session, command, random);
  if (command.type === 'advanceResolution') return advanceResolution(session, random);
  if (command.type === 'syncPrivate') return syncPrivate(session, command);
  if (command.type === 'abortMatch') return abortMatch(session, command);
  return transition(session);
}
