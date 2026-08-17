/**
 * Shortcodes for the curated set, so `:` can find one by name.
 *
 * `emoji.ts` said that shipping the whole Unicode set with a search index was
 * the moment to add a dependency, and that this was not that moment. It still
 * is not: what a `:` menu needs is a name per emoji *this app already draws*,
 * which is this table - about six kilobytes of text against the ~1.5 MB an
 * emoji package brings, and it works offline, in an Electron package, with no
 * sprite sheet to load.
 *
 * The format is one `emoji:name` per entry, whitespace-separated, with extra
 * aliases appended after further colons - `👍:thumbsup:+1:yes`. It is written
 * as text rather than an object literal because a 450-entry object is a 450-
 * line diff every time one is added, and because the parse is four lines.
 *
 * Names follow the shortcodes people already have in their fingers from
 * Slack, GitHub and Discord, which mostly agree with each other. Where they
 * disagree, both are listed: nobody should have to learn which of the three
 * this app copied.
 */

const TABLE = `
😀:grinning 😃:smiley 😄:smile 😁:grin 😆:laughing:satisfied 😅:sweat_smile
😂:joy:lol 🤣:rofl:rolling 😊:blush 😇:innocent:angel 🙂:slightly_smiling
🙃:upside_down 😉:wink 😌:relieved 😍:heart_eyes 🥰:smiling_face_with_hearts
😘:kissing_heart 😗:kissing 😙:kissing_smiling_eyes 😚:kissing_closed_eyes
😋:yum 😛:stuck_out_tongue 😝:stuck_out_tongue_closed_eyes 😜:stuck_out_tongue_wink
🤪:zany 🤨:raised_eyebrow 🧐:monocle 🤓:nerd 😎:sunglasses:cool 🥳:partying
😏:smirk 😒:unamused 😞:disappointed 😔:pensive 😟:worried 😕:confused
🙁:slightly_frowning 😣:persevere 😖:confounded 😫:tired 😩:weary 🥺:pleading
😢:cry:sad 😭:sob:crying 😤:triumph:huff 😠:angry 😡:rage:mad 🤬:cursing
🤯:exploding_head:mindblown 😳:flushed 🥵:hot 🥶:cold 😱:scream 😨:fearful
😰:anxious 😥:sad_relieved 😓:sweat 🤗:hugs 🤔:thinking:think 🤭:hand_over_mouth
🤫:shushing:quiet 🤥:lying 😶:no_mouth 😐:neutral 😑:expressionless 😬:grimacing
🙄:roll_eyes 😯:hushed 😦:frowning 😧:anguished 😮:open_mouth 😲:astonished
🥱:yawning 😴:sleeping 🤤:drooling 😪:sleepy 😵:dizzy_face 🤐:zipper_mouth
🥴:woozy 🤢:nauseated 🤮:vomiting 🤧:sneezing 😷:mask 🤒:thermometer_face
🤕:head_bandage 🤑:money_mouth 🤠:cowboy 😈:smiling_imp 👿:imp 💀:skull
👻:ghost 👽:alien 🤖:robot:bot 💩:poop 🙈:see_no_evil 🙉:hear_no_evil 🙊:speak_no_evil

👍:thumbsup:+1:yes 👎:thumbsdown:-1:no 👊:fist_bump ✊:fist 🤛:left_fist 🤜:right_fist
👏:clap 🙌:raised_hands 👐:open_hands 🤲:palms_up 🤝:handshake:deal 🙏:pray:thanks
✌️:v:peace 🤞:fingers_crossed 🤟:love_you 🤘:metal:rock 👌:ok_hand 🤌:pinched
🤏:pinching 👈:point_left 👉:point_right 👆:point_up 👇:point_down ☝️:index_up
✋:hand:stop 🤚:raised_back_of_hand 🖐️:splayed 🖖:vulcan 👋:wave:hello 🤙:call_me
💪:muscle:flex 🦾:mechanical_arm ✍️:writing 💅:nail_care 👀:eyes:look 👁️:eye 👣:footprints

👶:baby 🧒:child 👦:boy 👧:girl 🧑:person 👨:man 👩:woman 🧓:older_person
👴:old_man 👵:old_woman 🧑‍💻:technologist:developer 👨‍💻:man_technologist
👩‍💻:woman_technologist 🧑‍🔧:mechanic 🧑‍🚀:astronaut 🥷:ninja 🦸:superhero
🦹:supervillain 🧙:mage:wizard 🧑‍🎓:student:graduate 💂:guard 👮:police
🕵️:detective 👷:construction_worker 🧑‍🍳:cook:chef 🧑‍🌾:farmer 🧑‍🏫:teacher
🧑‍⚖️:judge 🤵:person_in_tuxedo 👰:person_with_veil

🐶:dog 🐱:cat 🐭:mouse 🐹:hamster 🐰:rabbit 🦊:fox 🐻:bear 🐼:panda 🐨:koala
🐯:tiger 🦁:lion 🐮:cow 🐷:pig 🐸:frog 🐵:monkey_face 🐔:chicken 🐧:penguin
🐦:bird 🐤:baby_chick 🦆:duck 🦅:eagle 🦉:owl 🦇:bat 🐺:wolf 🐗:boar 🐴:horse
🦄:unicorn 🐝:bee 🐛:bug 🦋:butterfly 🐌:snail 🐞:ladybug 🐜:ant 🕷️:spider
🦂:scorpion 🐢:turtle 🐍:snake 🦎:lizard 🦖:t_rex:dino 🐙:octopus 🦑:squid
🦀:crab 🐟:fish 🐬:dolphin 🐳:whale 🦈:shark 🐊:crocodile 🐅:leopard 🦓:zebra
🦍:gorilla 🐘:elephant 🦏:rhino 🐪:camel 🦒:giraffe 🐄:cow2 🐖:pig2 🐑:sheep
🐕:dog2 🐈:cat2 🕊️:dove

🍏:green_apple 🍎:apple 🍐:pear 🍊:tangerine 🍋:lemon 🍌:banana 🍉:watermelon
🍇:grapes 🍓:strawberry 🫐:blueberries 🍈:melon 🍒:cherries 🍑:peach 🥭:mango
🍍:pineapple 🥥:coconut 🥝:kiwi 🍅:tomato 🥑:avocado 🍆:aubergine:eggplant
🥔:potato 🥕:carrot 🌽:corn 🌶️:hot_pepper 🥒:cucumber 🥬:leafy_green 🥦:broccoli
🧄:garlic 🧅:onion 🍄:mushroom 🥜:peanuts 🌰:chestnut 🍞:bread 🥐:croissant
🥖:baguette 🥨:pretzel 🧀:cheese 🥚:egg 🍳:fried_egg 🧈:butter 🥞:pancakes
🧇:waffle 🥓:bacon 🍔:burger 🍟:fries 🍕:pizza 🌭:hotdog 🥪:sandwich 🌮:taco
🌯:burrito 🥙:wrap 🍜:ramen:noodles 🍲:stew 🍛:curry 🍣:sushi 🍱:bento 🥟:dumpling
🍤:fried_shrimp 🍚:rice 🍰:cake 🎂:birthday 🧁:cupcake 🍪:cookie 🍫:chocolate
🍬:candy 🍭:lollipop 🍩:doughnut ☕:coffee 🍵:tea 🧋:bubble_tea 🍺:beer 🍻:beers
🥂:champagne 🍷:wine 🥃:whisky 🧃:juice 🧊:ice

⚽:soccer:football 🏀:basketball 🏈:american_football ⚾:baseball 🎾:tennis
🏐:volleyball 🏉:rugby 🎱:8ball:pool 🏓:ping_pong 🏸:badminton 🥅:goal 🏒:hockey
🏑:field_hockey 🥍:lacrosse 🏏:cricket ⛳:golf 🏹:bow_and_arrow 🎣:fishing
🥊:boxing 🥋:martial_arts 🎽:running_shirt 🛹:skateboard 🛼:roller_skate 🛷:sled
⛸️:ice_skate 🎿:ski 🏂:snowboard 🏋️:lifting 🤼:wrestling 🤸:cartwheel
⛹️:bouncing_ball 🤺:fencing 🏊:swimming 🏄:surfing 🚴:cycling 🚵:mountain_biking
🧗:climbing 🎮:video_game:gaming 🕹️:joystick 🎲:game_die:dice 🧩:puzzle 🎯:dart
🎳:bowling 🎭:performing_arts 🎨:art 🎬:clapper:film 🎤:microphone 🎧:headphones
🎸:guitar 🥁:drum 🎹:musical_keyboard 🎺:trumpet 🎻:violin 🏆:trophy 🥇:first_place
🥈:second_place 🥉:third_place 🎉:tada:party 🎊:confetti 🎈:balloon

🚗:car 🚕:taxi 🚙:suv 🚌:bus 🚎:trolleybus 🏎️:racing_car 🚓:police_car
🚑:ambulance 🚒:fire_engine 🚚:truck 🚛:lorry 🚜:tractor 🛵:scooter
🏍️:motorcycle 🚲:bike 🛴:kick_scooter 🚨:siren 🚔:oncoming_police_car
🚂:locomotive 🚆:train 🚇:metro 🚊:tram 🚉:station ✈️:airplane 🛫:takeoff
🛬:landing 🚀:rocket:ship 🛸:ufo 🚁:helicopter ⛵:sailboat 🚤:speedboat
🛳️:passenger_ship ⚓:anchor 🏝️:desert_island 🏔️:snow_mountain ⛰️:mountain
🌋:volcano 🏕️:camping 🏖️:beach 🏙️:cityscape 🌃:night_city 🌉:bridge 🗼:tower
🗽:statue_of_liberty 🎡:ferris_wheel 🎢:roller_coaster 🎠:carousel 🗺️:map
🧭:compass ⛺:tent

💻:laptop:computer 🖥️:desktop ⌨️:keyboard 🖱️:mouse_three_button 🖨️:printer
📱:phone:mobile ☎️:telephone 📷:camera 🎥:movie_camera 📺:tv 🔋:battery
🔌:plug 💡:bulb:idea 🔦:flashlight 🕯️:candle 🧰:toolbox 🔧:wrench 🔨:hammer
⚙️:gear:settings 🧲:magnet 🔒:lock 🔓:unlock 🔑:key 🗝️:old_key 🚪:door
🪑:chair 🛏️:bed 🚿:shower 🧴:lotion 🧻:toilet_paper 📦:package 📫:mailbox
📮:postbox 📝:memo:note 📄:page 📚:books 📖:book 🔖:bookmark 📎:paperclip
📌:pushpin 📍:round_pushpin ✂️:scissors 📅:date 📆:calendar 🗓️:spiral_calendar
📊:bar_chart 📈:chart_up 📉:chart_down 💰:money_bag 💳:credit_card 💎:gem
⚖️:balance_scale 🧪:test_tube 🔬:microscope 🔭:telescope 💊:pill 💉:syringe
🩺:stethoscope 🛡️:shield 🏳️:white_flag

❤️:heart:red_heart 🧡:orange_heart 💛:yellow_heart 💚:green_heart 💙:blue_heart
💜:purple_heart 🖤:black_heart 🤍:white_heart 🤎:brown_heart 💔:broken_heart
❣️:heart_exclamation 💕:two_hearts 💞:revolving_hearts 💓:beating_heart
💗:growing_heart 💖:sparkling_heart 💘:cupid 💝:gift_heart ✨:sparkles ⭐:star
🌟:star2:glowing_star 💫:dizzy ⚡:zap:lightning 🔥:fire:flame 💥:boom:collision
☄️:comet 🌈:rainbow ☀️:sunny:sun 🌤️:sun_behind_cloud ☁️:cloud 🌧️:rain
⛈️:thunderstorm ❄️:snowflake 💧:droplet 🌊:ocean:sea:water ✅:white_check_mark:done
❌:x:cross ❓:question ❗:exclamation ⚠️:warning ♻️:recycle 🔰:beginner
💯:100:hundred 🔔:bell 🔕:no_bell 🎵:musical_note 🎶:notes ➕:plus ➖:minus
✔️:heavy_check_mark 🚫:no_entry_sign 🆗:ok 🆕:new 🔜:soon 🔝:top 🕐:clock
⏰:alarm_clock ⏳:hourglass 💤:zzz
`;

export interface NamedEmoji {
  emoji: string;
  /** The first name is the one shown; the rest are aliases that also match. */
  names: string[];
}

/** The table, parsed once. */
export const NAMED_EMOJI: NamedEmoji[] = TABLE.trim()
  .split(/\s+/)
  .flatMap((entry) => {
    const [emoji, ...names] = entry.split(':');
    // An entry with no name is a typo in the table above, not a thing to draw.
    if (!emoji || names.length === 0) return [];
    return [{ emoji, names }];
  });

/** How many suggestions a `:` menu shows. More than this is a scroll, not a menu. */
export const EMOJI_SUGGESTION_LIMIT = 8;

/**
 * Emoji whose name matches what has been typed so far.
 *
 * Ranked, because the order is the whole usefulness of a menu that shows eight
 * of four hundred: an exact name first, then names that start with the term,
 * then names that merely contain it. Without that, `:fire` offers
 * `fire_engine` above 🔥, which is the sort of thing that makes people stop
 * using a feature rather than report it.
 */
export function searchEmoji(term: string, limit = EMOJI_SUGGESTION_LIMIT): NamedEmoji[] {
  const needle = term.trim().toLowerCase().replace(/^:+/, '');
  if (needle.length === 0) return [];

  const scored: Array<{ entry: NamedEmoji; rank: number }> = [];

  for (const entry of NAMED_EMOJI) {
    let best = Infinity;
    for (const name of entry.names) {
      if (name === needle) best = Math.min(best, 0);
      else if (name.startsWith(needle)) best = Math.min(best, 1);
      else if (name.includes(needle)) best = Math.min(best, 2);
    }
    if (best !== Infinity) scored.push({ entry, rank: best });
  }

  // A stable sort by rank keeps the table's own order inside each rank, which
  // is roughly most-common-first because that is how the groups were written.
  return scored
    .sort((left, right) => left.rank - right.rank)
    .slice(0, limit)
    .map((row) => row.entry);
}

/**
 * The `:term` being typed at the caret, if there is one.
 *
 * Returns where it starts as well as the term, because replacing it needs both.
 * Null for everything that is not one, and the exclusions are the whole of the
 * work here: a colon in `https://` or in `10:30` must not open a menu, and a
 * colon that has already been closed - `:tada:` - is a finished shortcode
 * rather than a search in progress.
 */
export function emojiQueryAt(text: string, caret: number): { term: string; start: number } | null {
  const before = text.slice(0, caret);
  const colon = before.lastIndexOf(':');
  if (colon === -1) return null;

  const term = before.slice(colon + 1);
  // A space ends it: `:` on its own, then a word, is not one shortcode.
  if (/[\s:]/.test(term)) return null;
  // Two characters before anything is offered - `:` alone would show a menu
  // over every URL somebody types.
  if (term.length < 2) return null;
  if (!/^[a-z0-9_+-]+$/i.test(term)) return null;

  // What precedes the colon decides whether it is a shortcode at all. Start of
  // line or after whitespace is one; `https:` and `10:` are not.
  const preceding = colon === 0 ? '' : (before[colon - 1] ?? '');
  if (preceding !== '' && !/\s/.test(preceding)) return null;

  return { term, start: colon };
}
