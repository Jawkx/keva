# Effect Chains

## The game card example

```tsx
// BAD: 4 effects chaining state updates = 4 extra renders
useEffect(() => {
  if (card?.gold) setGoldCardCount((c) => c + 1);
}, [card]);
useEffect(() => {
  if (goldCardCount > 3) {
    setRound((r) => r + 1);
    setGoldCardCount(0);
  }
}, [goldCardCount]);
useEffect(() => {
  if (round > 5) setIsGameOver(true);
}, [round]);
useEffect(() => {
  if (isGameOver) alert("Good game!");
}, [isGameOver]);

// GOOD: all logic in the event handler, derived state inline
const isGameOver = round > 5;

function handlePlaceCard(nextCard) {
  if (isGameOver) throw Error("Game already ended.");
  setCard(nextCard);
  if (nextCard.gold) {
    if (goldCardCount < 3) {
      setGoldCardCount(goldCardCount + 1);
    } else {
      setGoldCardCount(0);
      setRound(round + 1);
      if (round === 5) alert("Good game!");
    }
  }
}
```
