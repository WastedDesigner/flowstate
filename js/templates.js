// Sample flowcharts. Each one is a real, checkable chart — not a placeholder.
import { newDoc, newNode, newEdge } from './model.js';
import { SHAPES } from './shapes.js';

function chart(spec, settings) {
  const doc = newDoc(spec.name);
  doc.settings = { ...doc.settings, ...settings, theme: settings?.theme || doc.settings.theme };
  const map = new Map();
  for (const [key, type, cx, cy, text, code] of spec.nodes) {
    const def = SHAPES[type];
    const n = newNode(type, cx - def.size[0] / 2, cy - def.size[1] / 2, doc.settings, text);
    if (code) n.code = { lang: code[0], source: code[1] };
    else n.code = { lang: 'none', source: '' };
    map.set(key, n);
    doc.nodes.push(n);
  }
  for (const [from, to, label, fp, tp] of spec.edges) {
    const e = newEdge(map.get(from).id, map.get(to).id, doc.settings, label || '');
    if (fp) e.fromPort = fp;
    if (tp) e.toPort = tp;
    doc.edges.push(e);
  }
  return doc;
}

export const TEMPLATES = [
  {
    id: 'starter', name: 'Simple sequence', desc: 'Start → two steps → End. A clean base to build on.',
    spec: {
      name: 'Simple sequence',
      nodes: [
        ['s', 'start', 420, 90, 'Start'],
        ['a', 'process', 420, 230, 'Do the first thing'],
        ['b', 'process', 420, 370, 'Do the next thing'],
        ['e', 'end', 420, 510, 'End'],
      ],
      edges: [['s', 'a'], ['a', 'b'], ['b', 'e']],
    },
  },
  {
    id: 'login', name: 'User login', desc: 'Validation, retries and a lockout branch. Includes JavaScript snippets.',
    spec: {
      name: 'User login',
      nodes: [
        ['s', 'start', 430, 80, 'Start'],
        ['in', 'io', 430, 210, 'Read email and password', ['javascript', "const { email, password } = form.values();\nif (!email || !password) {\n  return showError('Both fields are required');\n}"]],
        ['find', 'data', 430, 350, 'Look up the account', ['javascript', "const user = await db.users.findOne({ email });"]],
        ['exists', 'decision', 430, 500, 'Account found?'],
        ['check', 'decision', 430, 680, 'Password correct?', ['javascript', "const ok = await verifyHash(password, user.hash);\nif (ok) {\n  return grantSession(user);\n}"]],
        ['attempts', 'decision', 760, 680, '3 failed tries?'],
        ['lock', 'process', 1040, 680, 'Lock the account for 15 minutes'],
        ['retry', 'process', 760, 500, 'Show "wrong details" and count the attempt'],
        ['token', 'process', 430, 850, 'Issue a session token'],
        ['home', 'io', 430, 980, 'Show the dashboard'],
        ['e', 'end', 430, 1110, 'End'],
        ['e2', 'end', 1040, 850, 'End (locked)'],
      ],
      edges: [
        ['s', 'in'], ['in', 'find'], ['find', 'exists'],
        ['exists', 'check', 'Yes'], ['exists', 'retry', 'No', 'e', 'n'],
        ['check', 'token', 'Yes'], ['check', 'attempts', 'No', 'e', 'w'],
        ['attempts', 'lock', 'Yes', 'e', 'w'], ['attempts', 'retry', 'No', 'n', 's'],
        ['retry', 'in', 'Try again', 'w', 'e'],
        ['lock', 'e2'], ['token', 'home'], ['home', 'e'],
      ],
    },
  },
  {
    id: 'atm', name: 'ATM withdrawal', desc: 'Classic teaching example: PIN attempts, balance check, dispense.',
    spec: {
      name: 'ATM withdrawal',
      nodes: [
        ['s', 'start', 420, 80, 'Start'],
        ['card', 'io', 420, 210, 'Read the card'],
        ['pin', 'io', 420, 340, 'Ask for the PIN'],
        ['ok', 'decision', 420, 480, 'PIN correct?'],
        ['tries', 'decision', 740, 480, 'Third attempt?'],
        ['keep', 'process', 1010, 480, 'Retain the card'],
        ['amt', 'io', 420, 650, 'Ask for the amount'],
        ['funds', 'decision', 420, 800, 'Enough balance?'],
        ['cash', 'process', 420, 960, 'Dispense the cash'],
        ['debit', 'data', 420, 1090, 'Update the balance'],
        ['recpt', 'decision', 420, 1240, 'Receipt wanted?'],
        ['print', 'process', 720, 1240, 'Print the receipt'],
        ['eject', 'process', 420, 1400, 'Return the card'],
        ['e', 'end', 420, 1530, 'End'],
        ['e2', 'end', 1010, 650, 'End'],
      ],
      edges: [
        ['s', 'card'], ['card', 'pin'], ['pin', 'ok'],
        ['ok', 'amt', 'Yes'], ['ok', 'tries', 'No', 'e', 'w'],
        ['tries', 'keep', 'Yes', 'e', 'w'], ['tries', 'pin', 'No', 'n', 'e'],
        ['keep', 'e2'],
        ['amt', 'funds'], ['funds', 'cash', 'Yes'], ['funds', 'amt', 'No', 'w', 'w'],
        ['cash', 'debit'], ['debit', 'recpt'],
        ['recpt', 'print', 'Yes', 'e', 'n'], ['recpt', 'eject', 'No'],
        ['print', 'eject', '', 's', 'e'], ['eject', 'e'],
      ],
    },
  },
  {
    id: 'bubble', name: 'Bubble sort', desc: 'Nested loops with a swap flag. Python attached to every step.',
    spec: {
      name: 'Bubble sort',
      nodes: [
        ['s', 'start', 430, 80, 'Start'],
        ['in', 'io', 430, 210, 'Read the list', ['python', 'values = [int(v) for v in input().split()]\nn = len(values)']],
        ['init', 'process', 430, 350, 'swapped = True', ['python', 'swapped = True']],
        ['loop', 'decision', 430, 500, 'swapped?', ['python', 'while swapped:\n    swapped = False']],
        ['reset', 'process', 430, 670, 'swapped = False; i = 0', ['python', 'swapped = False\ni = 0']],
        ['inner', 'decision', 430, 830, 'i < n - 1?', ['python', 'if i < n - 1:\n    pass']],
        ['cmp', 'decision', 430, 1010, 'values[i] > values[i+1]?', ['python', 'if values[i] > values[i + 1]:\n    pass']],
        ['swap', 'process', 760, 1010, 'Swap them; swapped = True', ['python', 'values[i], values[i + 1] = values[i + 1], values[i]\nswapped = True']],
        ['incr', 'process', 430, 1180, 'i = i + 1', ['python', 'i += 1']],
        ['out', 'io', 760, 500, 'Print the sorted list', ['python', 'print(" ".join(str(v) for v in values))']],
        ['e', 'end', 760, 350, 'End'],
      ],
      edges: [
        ['s', 'in'], ['in', 'init'], ['init', 'loop'],
        ['loop', 'reset', 'Yes'], ['loop', 'out', 'No', 'e', 'w'],
        ['reset', 'inner'], ['inner', 'cmp', 'Yes'], ['inner', 'loop', 'No', 'w', 'w'],
        ['cmp', 'swap', 'Yes', 'e', 'n'], ['cmp', 'incr', 'No'],
        ['swap', 'incr', '', 's', 'e'],
        ['incr', 'inner', 'Repeat', 'w', 'w'],
        ['out', 'e'],
      ],
    },
  },
  {
    id: 'triage', name: 'Support ticket triage', desc: 'Three-way branch, escalation path and an SLA timer.',
    spec: {
      name: 'Support ticket triage',
      nodes: [
        ['s', 'start', 470, 80, 'Ticket arrives'],
        ['read', 'process', 470, 210, 'Read the ticket and tag the product'],
        ['sev', 'decision', 470, 360, 'How severe?'],
        ['p1', 'process', 150, 520, 'Page the on-call engineer'],
        ['p2', 'process', 470, 520, 'Assign to the product team'],
        ['p3', 'process', 790, 520, 'Add to the weekly backlog'],
        ['ack', 'process', 470, 670, 'Reply to the customer within the SLA'],
        ['fixed', 'decision', 470, 830, 'Resolved in one reply?'],
        ['esc', 'process', 820, 830, 'Escalate to tier 2'],
        ['wait', 'delay', 820, 980, 'Wait for the engineer'],
        ['close', 'process', 470, 1000, 'Close the ticket and record the cause'],
        ['survey', 'io', 470, 1130, 'Send the satisfaction survey'],
        ['e', 'end', 470, 1260, 'End'],
      ],
      edges: [
        ['s', 'read'], ['read', 'sev'],
        ['sev', 'p1', 'Critical', 'w', 'n'], ['sev', 'p2', 'Normal'], ['sev', 'p3', 'Low', 'e', 'n'],
        ['p1', 'ack', '', 's', 'w'], ['p2', 'ack'], ['p3', 'ack', '', 's', 'e'],
        ['ack', 'fixed'],
        ['fixed', 'close', 'Yes'], ['fixed', 'esc', 'No', 'e', 'n'],
        ['esc', 'wait'], ['wait', 'fixed', 'Re-check', 'w', 'e'],
        ['close', 'survey'], ['survey', 'e'],
      ],
    },
  },
  {
    id: 'guess', name: 'Guess the number', desc: 'A small game loop — good for showing loop-exit checks.',
    spec: {
      name: 'Guess the number',
      nodes: [
        ['s', 'start', 420, 80, 'Start'],
        ['pick', 'process', 420, 210, 'Pick a secret number 1–100', ['python', 'import random\nsecret = random.randint(1, 100)\ntries = 0']],
        ['ask', 'io', 420, 350, 'Ask the player to guess', ['python', 'guess = int(input("Your guess: "))\ntries += 1']],
        ['cmp', 'decision', 420, 500, 'Guess == secret?', ['python', 'if guess == secret:\n    print("Correct!")']],
        ['high', 'decision', 740, 500, 'Guess too high?', ['python', 'if guess > secret:\n    print("Lower")\nelse:\n    print("Higher")']],
        ['lower', 'io', 1040, 420, 'Say "lower"'],
        ['higher', 'io', 1040, 580, 'Say "higher"'],
        ['win', 'io', 420, 660, 'Celebrate and show the number of tries', ['python', 'print(f"Solved in {tries} tries")']],
        ['e', 'end', 420, 790, 'End'],
      ],
      edges: [
        ['s', 'pick'], ['pick', 'ask'], ['ask', 'cmp'],
        ['cmp', 'win', 'Yes'], ['cmp', 'high', 'No', 'e', 'w'],
        ['high', 'lower', 'Yes', 'e', 'w'], ['high', 'higher', 'No', 's', 'w'],
        ['lower', 'ask', '', 'n', 'e'], ['higher', 'ask', '', 's', 'e'],
        ['win', 'e'],
      ],
    },
  },
  {
    id: 'order', name: 'Order fulfilment', desc: 'Stock check, payment, subprocess and a database write.',
    spec: {
      name: 'Order fulfilment',
      nodes: [
        ['s', 'start', 440, 80, 'Order placed'],
        ['val', 'process', 440, 210, 'Validate the basket'],
        ['stock', 'data', 440, 350, 'Check stock levels'],
        ['avail', 'decision', 440, 500, 'All items in stock?'],
        ['back', 'process', 790, 500, 'Create a back-order'],
        ['notify', 'io', 790, 640, 'Email the customer'],
        ['pay', 'subroutine', 440, 670, 'Take payment (see payment chart)'],
        ['paid', 'decision', 440, 820, 'Payment captured?'],
        ['fail', 'process', 790, 820, 'Release the reservation'],
        ['pick', 'process', 440, 980, 'Pick and pack'],
        ['ship', 'process', 440, 1110, 'Hand to the courier'],
        ['save', 'data', 440, 1250, 'Record the shipment'],
        ['doc', 'document', 440, 1400, 'Invoice'],
        ['e', 'end', 440, 1540, 'End'],
        ['e2', 'end', 790, 780, 'End'],
        ['e3', 'end', 1080, 820, 'End'],
      ],
      edges: [
        ['s', 'val'], ['val', 'stock'], ['stock', 'avail'],
        ['avail', 'pay', 'Yes'], ['avail', 'back', 'No', 'e', 'w'],
        ['back', 'notify'], ['notify', 'e2'],
        ['pay', 'paid'], ['paid', 'pick', 'Yes'], ['paid', 'fail', 'No', 'e', 'w'],
        ['fail', 'e3', '', 'e', 'w'],
        ['pick', 'ship'], ['ship', 'save'], ['save', 'doc'], ['doc', 'e'],
      ],
    },
  },
];

export function buildTemplate(id, settings) {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) return null;
  return chart(t.spec, settings);
}
