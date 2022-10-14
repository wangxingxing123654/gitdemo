class Tree {
    constructor(){
       console.log('tree')
       this.root = null;
    }

}


class Node {
    constructor(value){
        this.left = null;
        this.right = null;
        this.value = value;
    }
}




const tree = new Tree();


console.log(tree,'tree--')
