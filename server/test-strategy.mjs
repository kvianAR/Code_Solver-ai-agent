export function testStrategy(problem){
  const topics=(problem.topics||[]).join(' ').toLowerCase(),title=String(problem.title||'').toLowerCase();
  const family=/linked list/.test(topics+' '+title)?'linked-list':/graph|tree|breadth.first|depth.first/.test(topics)?'graph':/dynamic programming|memoization/.test(topics)?'dynamic-programming':/array|two pointer|sliding window/.test(topics)?'array':'general';
  const plans={
    'linked-list':['one and two nodes','head or tail changes','duplicate values when allowed','empty lists or cycles only if the statement permits them'],
    graph:['smallest allowed graph','disconnected components only when allowed','multiple paths and edge directions','cycles only when compatible with the constraints'],
    'dynamic-programming':['smallest base state','overlapping subproblems','ties between candidate choices','zero or negative values only when allowed'],
    array:['smallest allowed length','duplicate values when allowed','boundary positions and absent targets when allowed','required in-place mutation'],
    general:['minimum permitted size','boundary values','ties and duplicates when relevant','return type and mutation contract']
  };
  return {family,checks:plans[family]};
}
