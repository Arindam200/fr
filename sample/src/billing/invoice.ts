export function total(items: { price: number; qty: number }[]) {
  return items.reduce((sum, i) => sum + i.price * i.qty, 0);
}
