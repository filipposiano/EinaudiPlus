export async function adminListBikes(_input, { bikeRepository }) {
  return bikeRepository.adminList();
}
