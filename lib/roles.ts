import type { Player, RoleId } from './contracts.ts';

export const ROLE_IDS: RoleId[] = ['illuminator', 'guardian', 'trapper', 'thief', 'shifter', 'recorder'];
export const MAX_CONCEALED_EDGES = 4;
export const MAX_MINE_SHIFTS = 7;

/** Saved rounds from before the limit start with seven remaining moves. */
export const remainingMineShifts = (player: Pick<Player, 'role' | 'shifts'>): number =>
  player.role === 'shifter' ? (player.shifts ?? MAX_MINE_SHIFTS) : 0;

export const ABILITY_PROLOGUE = {
  title: '길잡이들의 시험',
  text: '오래된 광산에서는 길잡이를 뽑는 시험이 열립니다. 도전자들은 각자의 길에 지뢰를 숨기고, 서로의 길을 건너 정상으로 향합니다. 자기 손으로 만든 길은 밟을 수 없습니다. 다른 이의 발걸음을 기억하며, 당신이 지닌 특별한 재주에 다음 한 걸음을 맡겨보세요.',
};

export const ROLE_DETAILS: Record<RoleId, { name: string; subtitle: string; story: string[]; approach: string; description: string; rules: string[] }> = {
  illuminator: {
    name: '잔광의 인도', subtitle: '마지막 불씨를 간직한 등불',
    story: [
      '채굴장의 불이 모두 꺼진 밤, 당신은 낡은 등불 하나를 들고 돌아왔습니다. 그 불빛 아래에서는 어둠에 묻혔던 길의 흔적이 잠깐씩 모습을 드러냈습니다.',
      '이제 시험에 나설 때면 남들보다 조금 더 오래 불을 밝힐 수 있습니다. 낯선 길 앞에서 등불을 켤지, 이미 본 발걸음을 믿고 다음 갈림길을 위해 불씨를 남겨둘지는 당신의 몫입니다.',
    ],
    approach: '기억만으로 확신하기 어려운 갈림길에서 여분의 빛을 쓰세요.',
    description: '매 라운드 기본 힌트보다 2개를 더 받아, 두 번 더 길을 확인할 수 있습니다.',
    rules: ['기본 설정에서는 힌트 5개로 시작합니다.', '힌트 코인과 승점 코인은 별개이며, 남은 힌트는 승점으로 바뀌지 않습니다.'],
  },
  guardian: {
    name: '귀환의 가호', subtitle: '출발점으로 돌아오는 기도',
    story: [
      '광산 입구의 작은 사당에서, 당신은 두 닢의 낡은 동전을 받았습니다. 사당지기는 위험한 순간에 하나를 쥐면 다시 길 앞에 설 기회를 얻을 것이라고 말했습니다.',
      '폭음이 가라앉으면 당신은 출발점에서 눈을 뜹니다. 방금 밟은 지뢰는 여전히 그 자리에 있습니다. 손안의 동전 하나가 사라진 대신, 이제 어느 길을 피해야 하는지 알고 있습니다.',
    ],
    approach: '위험을 감수한 탐색이 실패해도, 알아낸 위치를 기억하고 다시 출발하세요.',
    description: '지뢰가 터진 뒤 가호를 쓰면 같은 차례에 밑변에서 다시 출발합니다.',
    rules: ['라운드마다 가호 2개를 받습니다.', '폭발은 모두에게 보이며 지뢰는 그대로 남습니다.', '한 차례에 가호를 여러 번 사용할 수 있습니다.'],
  },
  trapper: {
    name: '기만의 장막', subtitle: '아무도 읽지 못하는 흔적',
    story: [
      '당신은 오래전부터 지뢰를 묻은 자리를 감추는 일을 해왔습니다. 뒤집힌 흙을 고르고, 작은 돌을 돌려놓으면 방금 손댄 길도 오랫동안 아무도 지나지 않은 것처럼 보입니다.',
      '시험에서는 멀쩡한 길에도 같은 흔적을 남길 수 있습니다. 누군가 그곳을 살펴보아도 무엇이 숨었는지 답을 얻지 못합니다. 위험한 길을 감쌀지, 빈 길에 의심을 심을지, 당신은 네 곳까지 골라 손을 댈 수 있습니다.',
    ],
    approach: '안전한 길과 지뢰를 어떤 비율로 위장할지 정해 상대의 판단을 흔드세요.',
    description: '자기 판을 새로 배치할 때 길을 최대 4개 위장합니다. 그 길의 힌트는 판독 불가로 표시됩니다.',
    rules: ['지뢰가 있는 길과 없는 길 모두 위장할 수 있습니다.', '출발점 사이의 길은 위장할 수 없습니다.', '기존 판을 유지하는 라운드에는 위장을 바꿀 수 없습니다. 능력이 바뀌어도 기존 위장은 남습니다.', '판독 불가여도 상대의 힌트 코인은 소모됩니다.'],
  },
  thief: {
    name: '타인의 기억', subtitle: '접힌 종이 너머의 단서',
    story: [
      '도전자들이 판에 시선을 빼앗긴 사이, 당신의 눈은 그들이 접어 둔 메모를 향합니다. 종이가 잠깐 펼쳐지는 순간이면 충분합니다. 어느 판에, 어느 길을, 어떤 표시로 남겼는지 읽어낼 수 있으니까요.',
      '하지만 급히 그은 표시는 폭발을 직접 본 기록일 수도, 망설이다 적어 둔 짐작일 수도 있습니다. 종이가 다시 접히고 나면, 그 짧은 기억을 믿을지는 당신이 결정해야 합니다.',
    ],
    approach: '다른 사람의 메모를 읽고, 당신이 직접 본 이동과 맞춰 판단하세요.',
    description: '내 차례에 다른 사람의 메모를 골라 잠깐 훔쳐봅니다. 그 기록도 틀릴 수 있습니다.',
    rules: ['라운드마다 2번 사용할 수 있습니다.', '한 번에 기본 메모 슬롯 수만큼 선택합니다.', '훔쳐본 내용은 자동으로 저장되지 않습니다.'],
  },
  shifter: {
    name: '위험의 전이', subtitle: '익숙한 길에 남기는 작은 변화',
    story: [
      '여러 사람이 당신이 만든 길에 거듭 도전합니다. 처음에는 발을 떼지 못하던 이들도 이제 몇몇 구간을 주저 없이 건넙니다. 그들이 당신의 길을 익혀가고 있다는 뜻입니다.',
      '다음 탐색에 나서기 전, 당신은 묻어 둔 지뢰 하나를 꺼내 다른 자리에 숨길 수 있습니다. 돌 하나를 고쳐 놓는 짧은 손길 뒤에도 정상으로 이어지는 길은 남습니다. 다만, 누군가의 메모는 조금 전의 길을 가리키게 됩니다.',
    ],
    approach: '자기 차례 시작에 상대가 익힌 길을 바꿀지, 기존 배치를 유지할지 고르세요.',
    description: '두 번째 자기 차례부터, 판을 고르기 전에 지뢰 하나를 옮깁니다. 라운드당 최대 7회입니다.',
    rules: ['지뢰를 옮길 때만 1회를 사용합니다. 건너뛰면 횟수를 쓰지 않습니다.', '내 판은 직접 플레이하지 않습니다. 이동 뒤에는 도전할 다른 사람의 판을 고릅니다.', '지뢰 수는 그대로이며 안전한 길을 하나 이상 남겨야 합니다.', '다른 사람의 메모는 바뀌지 않습니다.'],
  },
  recorder: {
    name: '기억의 각인', subtitle: '흐려지는 기억을 붙잡는 여백',
    story: [
      '당신의 수첩에는 광산의 이름 대신 길의 주인과 짧은 선들이 빼곡합니다. 다른 이가 주저 없이 건넌 자리, 폭음이 울린 갈림길, 끝내 확인하지 못한 구간마다 당신만의 표시가 붙어 있습니다.',
      '여분의 종이를 챙긴 덕분에 더 많은 기억을 남길 수 있습니다. 다만 종이에 적혔다고 모두 사실이 되는 것은 아닙니다. 누군가 길을 바꾸었을지도 모르는 순간, 당신은 오래된 표시 옆에 다시 물음표를 그립니다.',
    ],
    approach: '더 많은 판의 단서를 남기고, 새로 알게 된 사실에 맞춰 직접 고치세요.',
    description: '기본보다 두 배 많은 메모 슬롯으로 길에 대한 기억과 추측을 남깁니다.',
    rules: ['3~4명은 2칸, 5~6명은 4칸입니다.', '기록은 직접 고치기 전까지 그대로 남습니다.', '새 라운드가 시작되면 모든 메모가 지워집니다.'],
  },
};

export const baseMemoSlots = (playerCount: number): number => Math.max(0, Math.floor((playerCount - 1) / 2));
export const memoCapacity = (playerCount: number, role?: RoleId): number => baseMemoSlots(playerCount) * (role === 'recorder' ? 2 : 1);
export const roundHintCoins = (hintCoins: number, role?: RoleId): number => hintCoins + (role === 'illuminator' ? 2 : 0);

/** Players choose freely; roles with zero usable memo slots are excluded. */
export const availableRoles = (playerCount: number): RoleId[] => playerCount === 2 ? ROLE_IDS.filter((role) => role !== 'thief' && role !== 'recorder') : [...ROLE_IDS];

/** Demo opponents choose automatically from the same available roles. */
export function randomRole(playerCount: number, random: () => number = Math.random): RoleId {
  const available = availableRoles(playerCount);
  return available[Math.min(available.length - 1, Math.max(0, Math.floor(random() * available.length)))];
}
