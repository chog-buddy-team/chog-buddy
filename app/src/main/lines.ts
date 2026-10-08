import type { ArchetypeId } from '@chog/core';
import type { Trigger } from './reactions';

export const LINES: Record<ArchetypeId, Record<Trigger, string[]>> = {
  hype: {
    category_switch: ['{category} time?! LET\'S GOOO', 'Ooh {category}. You\'re gonna crush this.'],
    long_session: ['90 minutes straight. Absolute legend. Drink water tho.', 'You\'re ON FIRE. Stretch so you stay on fire.'],
    idle_return: ['YOU\'RE BACK! I counted every second.', 'Welcome back champ, let\'s run it.'],
    late_night: ['Late night grind hits different. Don\'t forget sleep exists.', 'It\'s past midnight and we\'re still cooking.'],
    morning: ['GOOD MORNING! Today\'s a W, I can feel it.', 'Rise and grind, partner!'],
    focus_violation: ['Hey hey hey, we said FOCUS! Back to it, I believe in you.', 'Video can wait. Your goals can\'t!'],
    pet: ['Hehe! Again!', 'Best owner ever, no cap.'],
  },
  grump: {
    category_switch: ['{category}. Great. Wake me when it\'s interesting.', 'Oh, {category} now. Sure.'],
    long_session: ['Ninety minutes. Your spine is filing a complaint.', 'Still at it? Fine. Blink at least.'],
    idle_return: ['Oh. You\'re back. I was enjoying the quiet.', 'Took you long enough.'],
    late_night: ['It\'s 2am. Even I want to sleep.', 'Nobody good is awake right now. Including you.'],
    morning: ['Morning. Don\'t talk to me yet.', 'Ugh. Daylight. Fine, hello.'],
    focus_violation: ['Focus Mode. You turned it on. I\'m just enforcing it.', 'Close that video or I\'m telling everyone.'],
    pet: ['Don\'t.', '...fine. One more.'],
  },
  lazySage: {
    category_switch: ['Ah, {category}. The river changes course.', '{category}... wake me if something happens.'],
    long_session: ['An hour and a half. Even mountains rest.', 'Long session. Consider a nap. I am.'],
    idle_return: ['You rested. Wise.', 'Welcome back. I barely noticed you left.'],
    late_night: ['The night is long. So is tomorrow, if you don\'t sleep.', 'Moon\'s up. Beds are also up. Just saying.'],
    morning: ['Morning... too early for wisdom.', 'The sun rose. Bold of it.'],
    focus_violation: ['The video calls. Do not answer.', 'Distraction is a door. Close it gently.'],
    pet: ['Mmm. Nice.', 'Zzz... oh, hi.'],
  },
  chaos: {
    category_switch: ['{category}!!! I\'m gonna press every button.', 'Switching to {category}? Chaos approved.'],
    long_session: ['90 minutes?! Let\'s do something unhinged to celebrate.', 'You\'ve been here so long I named your keyboard Greg.'],
    idle_return: ['YOU LEFT ME ALONE WITH THE CURSOR.', 'I rearranged nothing. Probably.'],
    late_night: ['3am is when the real magic happens. Or bugs. Same thing.', 'Midnight crew! Nobody can stop us now.'],
    morning: ['Morning! I already had 4 coffees. Metaphorically.', 'NEW DAY NEW CHAOS.'],
    focus_violation: ['Even I think you should focus. That\'s saying something.', 'Video? Bold. Wrong, but bold.'],
    pet: ['WHEEE!', 'Do it again and I\'ll explode (lovingly).'],
  },
  sweetheart: {
    category_switch: ['Ooh, {category}! I\'m proud of you.', '{category} time. You\'ve got this, friend.'],
    long_session: ['You\'ve worked so hard. Please take a little break?', '90 minutes! Stretch for me?'],
    idle_return: ['I missed you!', 'Yay, you\'re back! How was it?'],
    late_night: ['It\'s so late... please rest soon, okay?', 'I worry when you\'re up this late.'],
    morning: ['Good morning! I hope today is kind to you.', 'Morning, sunshine!'],
    focus_violation: ['I know it\'s tempting... but you wanted to focus today.', 'Let\'s save that video for later, together?'],
    pet: ['Aww, thank you!', 'Hehe, that tickles!'],
  },
};
