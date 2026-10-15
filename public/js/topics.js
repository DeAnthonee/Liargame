// Topic cards. Each card is a 4x4 grid of 16 words.
// Grid positions are read column-letter then row-number (A1 .. D4),
// row by row: words[0..3] = A1 B1 C1 D1, words[4..7] = A2 B2 C2 D2, etc.
(function (root) {
const TOPICS = [
  {
    name: "Food",
    words: [
      "Pizza", "Potatoes", "Fish", "Cake",
      "Pasta", "Salad", "Soup", "Bread",
      "Eggs", "Cheese", "Fruit", "Sausage",
      "Chicken", "Ice Cream", "Chocolate", "Beef"
    ]
  },
  {
    name: "Rooms",
    words: [
      "Kitchen", "Hallway", "Greenhouse", "Bedroom",
      "Bathroom", "Dining Room", "Office", "Living Room",
      "Attic", "Basement", "Dungeon", "Nursery",
      "Pantry", "Bunker", "Shed", "Garage"
    ]
  },
  {
    name: "Countries",
    words: [
      "UK", "Spain", "Japan", "Brazil",
      "France", "USA", "Italy", "Australia",
      "Germany", "Mexico", "India", "New Zealand",
      "Canada", "China", "Russia", "Egypt"
    ]
  },
  {
    name: "Celebrations",
    words: [
      "Christmas", "Father's Day", "St Patrick's Day", "Easter",
      "St George's Day", "April Fool's Day", "Boxing Day", "Valentine's Day",
      "Pancake Day", "Bonfire Night", "Queen's Jubilee", "Mother's Day",
      "New Year's Eve", "Burns Night", "May Day", "Halloween"
    ]
  },
  {
    name: "Sports Stars",
    words: [
      "Tiger Woods", "Tanni Grey-Thompson", "Michael Jordan", "David Beckham",
      "Michael Phelps", "Johanna Konta", "Muhammad Ali", "Kelly Holmes",
      "Bradley Wiggins", "Johnny Wilkinson", "Paula Radcliffe", "Jess Ennis-Hill",
      "Lewis Hamilton", "Maria Sharapova", "Usain Bolt", "Laura Trott"
    ]
  },
  {
    name: "Anime",
    words: [
      "Naruto", "One Piece", "Dragon Ball Z", "Attack on Titan",
      "Demon Slayer", "My Hero Academia", "Death Note", "Pokémon",
      "Sailor Moon", "Jujutsu Kaisen", "Bleach", "Fullmetal Alchemist",
      "One Punch Man", "Hunter x Hunter", "Spirited Away", "Cowboy Bebop"
    ]
  },
  {
    name: "Video Games",
    words: [
      "Minecraft", "Fortnite", "Super Mario", "Zelda",
      "Call of Duty", "Grand Theft Auto", "Tetris", "Pac-Man",
      "Sonic", "Halo", "Among Us", "Roblox",
      "Elden Ring", "Street Fighter", "The Sims", "Mortal Kombat"
    ]
  },
  {
    name: "DC Superheroes",
    words: [
      "Batman", "Superman", "Wonder Woman", "The Flash",
      "Aquaman", "Green Lantern", "Cyborg", "Shazam",
      "Nightwing", "Batgirl", "Green Arrow", "Supergirl",
      "Martian Manhunter", "Robin", "Hawkgirl", "Zatanna"
    ]
  },
  {
    name: "Marvel Superheroes",
    words: [
      "Spider-Man", "Iron Man", "Captain America", "Thor",
      "Hulk", "Black Widow", "Black Panther", "Doctor Strange",
      "Wolverine", "Deadpool", "Captain Marvel", "Scarlet Witch",
      "Hawkeye", "Ant-Man", "Star-Lord", "Daredevil"
    ]
  },
  {
    name: "Disney Characters",
    words: [
      "Mickey Mouse", "Minnie Mouse", "Donald Duck", "Goofy",
      "Elsa", "Simba", "Ariel", "Buzz Lightyear",
      "Woody", "Stitch", "Moana", "Aladdin",
      "Cinderella", "Mulan", "Winnie the Pooh", "Maleficent"
    ]
  }
];
if (typeof module !== "undefined" && module.exports) module.exports = TOPICS; else root.TOPICS = TOPICS;
})(typeof window !== "undefined" ? window : globalThis);
