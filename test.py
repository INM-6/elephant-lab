import json
from IPython.core.magics.namespace import NamespaceMagics
from IPython import get_ipython
#from neo.core import BaseNeo
nsm = NamespaceMagics()
nsm.shell = get_ipython().kernel.shell

def testfunc():
    nsm = NamespaceMagics()
    nsm.shell = get_ipython().kernel.shell
    from neo.core.baseneo import BaseNeo
    from neo.core.block import Block
    vals = nsm.who_ls()
    values = [v for v in vals if isinstance(eval(v), (BaseNeo, list))] # in ['Block', 'Segment', 'ChannelIndex', 
    for value in list(values):
        val = eval(value)
        if isinstance(val, list):
            if len(val) > 0 and isinstance(val[0], BaseNeo):
                    pass
            else:
                values.remove(value)
        if isinstance(val, Block):
            for i, seg in enumerate(val.list_children_by_class("Segment")):
                #globals()[''.join(['blchidx', str(i)])] = chidx
                values.append(''.join([value, '.segmets[', str(i), ']']))
                for j, sig in enumerate(seg.analogsignals):
                    #pass
                    values.append(''.join([values[-1-j], '.analogsigs[', str(j), ']']))

    return json.dumps(values)
    #return "abcdef"

print(testfunc())
